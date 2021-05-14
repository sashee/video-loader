const path = require("path");
const os = require("os");
const rimraf = require("rimraf");
const child_process = require("child_process");
const util = require("util");
const loaderUtils = require("loader-utils");
const crypto = require("crypto");
const findCacheDir = require("find-cache-dir");
const {promises: fs, constants, createWriteStream} = require("fs");
const JSZip = require("jszip");
const stream = require("stream");
const pjson = require("./package.json");

const finished = util.promisify(stream.finished);

const thunk = findCacheDir({name: pjson.name, thunk: true});

const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");

const fileExists = async (file) => {
	try {
		await fs.access(file, constants.F_OK);
		return true;
	}catch(e) {
		return false;
	}
};

const exec = util.promisify(child_process.exec);

const ASSET_PATH = process.env.ASSET_PATH || "/";

const getVersionHash = (() => {
	let prom = undefined;

	return () => prom = (prom || (async () => {
		const {stdout: versionString} = await exec("ffmpeg -version");

		return sha(sha(versionString) + sha(pjson.version));
	})());
})();

const getCacheDir = (() => {
	const cacheDir = thunk();

	let prom = undefined;
	return () => prom = (prom || (async () => {
		await fs.mkdir(cacheDir, {recursive: true});

		return cacheDir;
	})());
})();

const withTempDir = async (fn) => {
	const dir = await fs.mkdtemp(await fs.realpath(os.tmpdir()) + path.sep);
	try {
		return await fn(dir);
	}finally {
		rimraf(dir, () => {});
	}
};

module.exports = function (source) {
	const callback = this.async();
	(async () => {
		const cacheFile = path.join(await getCacheDir(), sha(await getVersionHash() + sha(source) + sha(this.request) + sha(process.env.NODE_ENV)));
		const data = await (async () => {
			if (await fileExists(cacheFile)) {
				const file = await fs.readFile(cacheFile);

				const zip = await JSZip.loadAsync(file);

				const data = JSON.parse(await zip.file("data.json").async("text"));
				const scenesInZip = zip.folder("scenes").folder(/^\d+\//);
				const scenes = await Promise.all(scenesInZip.map(async ({name}) => {
					const sceneFolder = zip.folder(name);
					const sceneData = JSON.parse(await sceneFolder.file("data.json").async("text"));
					const video = await sceneFolder.file("video.webm").async("nodebuffer");
					const lastImage = await sceneFolder.file("last.jpg").async("nodebuffer");

					return {
						numFrames: sceneData.numFrames,
						duration: sceneData.duration,
						video,
						lastImage,
					};
				}));
				return {
					firstImage: await zip.file("first.jpg").async("nodebuffer"),
					scenes,
					width: data.width,
					height: data.height,
				};
			}else {
				return withTempDir(async (dir) => {
					const options = loaderUtils.getOptions(this);
					options.scenes.reduce((memo, {end}) => {
						const realEnd = end === undefined ? Number.MAX_SAFE_INTEGER : end;
						if (memo >= realEnd) {
							throw new Error(`Scene ends must be increasing numbers. ${end} >= ${memo}`);
						}
						return realEnd;
					}, 0);

					const inputFile = path.join(dir, `input${path.extname(this.resource)}`);
					await fs.writeFile(inputFile, source, {encoding: "binary"});

					const firstImage = await (async () => {
						const firstImagePath = path.join(dir, "first.jpg");

						await exec(`ffmpeg -i ${inputFile} -vf "select=eq(n\\,0)" -q:v 1 ${firstImagePath}`);

						return await fs.readFile(firstImagePath);
					})();

					const {width, height} = await (async () => {
						const {stdout: dimensions} = await exec(`ffprobe -v error -show_entries stream=width,height -of json ${inputFile}`);
						return JSON.parse(dimensions).streams[0];
					})();

					const processedScenes = await options.scenes.reduce(async (memo, {end, speed}, i, l) => {
						await memo;

						const start = i === 0 ? 0 : l[i - 1].end;
						const processedVideoPath = path.join(dir, `scene-${i}.webm`);

						await exec(`ffmpeg -ss ${start} ${end !== undefined ? `-to ${end}` : ""} -i ${inputFile} -c:v libvpx-vp9 ${options.ultrafast_dev !== undefined && process.env.NODE_ENV === "development" ? "-deadline realtime -cpu-used 8 -crf 63 -b:v 0 -vf scale=320:-1 -preset ultrafast -speed 12" : "-lossless 1"} -an -filter:v "setpts=${1/(speed !== undefined ? speed : 1)}*PTS" ${processedVideoPath}`);

						const processedVideo = await fs.readFile(processedVideoPath);

						const lastImage = await (async () => {
							const lastImagePath = path.join(dir, `scene-last-${i}.jpg`);

							await exec(`ffmpeg -ss ${start} ${end !== undefined ? `-to ${end}` : ""} -i ${inputFile} -update 1 -q:v 1 ${lastImagePath}`);

							return await fs.readFile(lastImagePath);
						})();

						const {stdout: numFrames} = await exec(`ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of default=nokey=1:noprint_wrappers=1 ${processedVideoPath}`);
						const duration = await (async () => {
							const ffmpegCommand = `ffmpeg -i ${processedVideoPath} -v quiet -stats -f null -`;
							const {stderr: durationString} = await exec(ffmpegCommand);
							const {hours, minutes, seconds, mss} = durationString.trim().match(/time=(?<hours>\d+):(?<minutes>\d+):(?<seconds>\d+)\.(?<mss>\d+)\s[^\r]*$/).groups;
							return parseInt(hours, 10) * 60 * 60 + parseInt(minutes, 10) * 60 + parseInt(seconds, 10) + parseInt(mss, 10) / 1000;
						})();

						return [
							...await memo,
							{
								video: processedVideo,
								lastImage,
								numFrames: Number(numFrames),
								duration,
							}
						];
					}, []);

					const zip = new JSZip();
					zip.file("first.jpg", firstImage);
					zip.file("data.json", JSON.stringify({width, height}));
					const scenesFolder = zip.folder("scenes");
					processedScenes.forEach(({video, lastImage, numFrames, duration}, i) => {
						const sceneFolder = scenesFolder.folder(String(i));
						sceneFolder.file("video.webm", video);
						sceneFolder.file("last.jpg", lastImage);
						sceneFolder.file("data.json", JSON.stringify({numFrames, duration}));
					});

					await finished(
						zip.generateNodeStream({streamFiles: true})
							.pipe(createWriteStream(cacheFile))
					);

					return {
						firstImage,
						scenes: processedScenes,
						width,
						height,
					};
				});
			}
		})();

		const firstImageName = loaderUtils.interpolateName(this, "[name]-frame-first-[contenthash].jpg", {content: data.firstImage});
		this.emitFile(firstImageName, data.firstImage);
		const scenes = data.scenes.map(({video, lastImage, numFrames, duration}, i) => {
			const lastImageName = loaderUtils.interpolateName(this, `[name]-scene-${i}-last-[contenthash].jpg`, {content: lastImage});
			this.emitFile(lastImageName, lastImage);
			const videoName = loaderUtils.interpolateName(this, `[name]-scene-${i}-[contenthash].webm`, {content: video});
			this.emitFile(videoName, video);
			return {
				lastImage: `${ASSET_PATH}${lastImageName}`,
				video: `${ASSET_PATH}${videoName}`,
				numFrames,
				duration,
			};
		});

		const results = {
			firstImage: `${ASSET_PATH}${firstImageName}`,
			scenes,
			width: data.width,
			height: data.height,
		};

		return `export default ${JSON.stringify(results)}`;
	})().then((res) => callback(undefined, res), (err) => callback(err));
};

module.exports.raw = true;
