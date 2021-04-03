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

const thunk = findCacheDir({name: "pdf-loader", thunk: true});

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
		const cacheFile = path.join(await getCacheDir(), sha(await getVersionHash() + sha(source) + sha(this.request)));
		const data = await (async () => {
			if (await fileExists(cacheFile)) {
				const file = await fs.readFile(cacheFile);

				const zip = await JSZip.loadAsync(file);

				const data = JSON.parse(await zip.file("data.json").async("text"));
				return {
					firstImage: await zip.file("first.jpg").async("nodebuffer"),
					lastImage: await zip.file("last.jpg").async("nodebuffer"),
					numFrames: data.numFrames,
					processedVideo: await zip.file("video.webm").async("nodebuffer"),
					width: data.width,
					height: data.height,
				};
			}else {
				return withTempDir(async (dir) => {
					const options = this.getOptions();
					const speed = options.speed || 1;

					const inputFile = path.join(dir, `input.${path.extname(this.resource)}`);

					await fs.writeFile(inputFile, source, {encoding: "binary"});

					const processedVideoPath = path.join(dir, "processed.webm");

					await exec(`ffmpeg -i ${inputFile} -c:v libvpx-vp9 ${options.ultrafast !== undefined ? "-deadline realtime -cpu-used 8 -crf 63 -b:v 0 -vf scale=320:-1 -preset ultrafast -speed 12" : "-lossless 1"} -an -filter:v "setpts=${1/speed}*PTS" ${processedVideoPath}`);

					const processedVideo = await fs.readFile(processedVideoPath);

					const firstImagePath = path.join(dir, "first.jpg");

					await exec(`ffmpeg -i ${processedVideoPath} -vf "select=eq(n\\,0)" -q:v 1 ${firstImagePath}`);

					const lastImagePath = path.join(dir, "last.jpg");

					await exec(`ffmpeg -sseof -1 -i ${processedVideoPath} -update 1 -q:v 1 ${lastImagePath}`);

					const firstImage = await fs.readFile(firstImagePath);

					const lastImage = await fs.readFile(lastImagePath);

					const {stdout: numFrames} = await exec(`ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of default=nokey=1:noprint_wrappers=1 ${processedVideoPath}`);

					const {stdout: dimensions} = await exec(`ffprobe -v error -show_entries stream=width,height -of json ${processedVideoPath}`);
					const {width, height} = JSON.parse(dimensions).streams[0];

					const zip = new JSZip();
					zip.file("first.jpg", firstImage);
					zip.file("last.jpg", lastImage);
					zip.file("video.webm", processedVideo);
					zip.file("data.json", JSON.stringify({numFrames, width, height}));
					await finished(
						zip.generateNodeStream({streamFiles: true})
							.pipe(createWriteStream(cacheFile))
					);

					return {
						firstImage,
						lastImage,
						numFrames: Number(numFrames),
						processedVideo,
						width,
						height,
					};
				});
			}
		})();

		const firstImageName = loaderUtils.interpolateName(this, "[name]-frame-first-[contenthash].jpg", {content: data.firstImage});
		this.emitFile(firstImageName, data.firstImage);
		const lastImageName = loaderUtils.interpolateName(this, "[name]-frame-last-[contenthash].jpg", {content: data.lastImage});
		this.emitFile(lastImageName, data.lastImage);
		const processedVideoName = loaderUtils.interpolateName(this, "[name]-[contenthash].webm", {content: data.processedVideo});
		this.emitFile(processedVideoName, data.processedVideo);

		const results = {
			firstImage: `${ASSET_PATH}${firstImageName}`,
			lastImage: `${ASSET_PATH}${lastImageName}`,
			numFrames: Number(data.numFrames),
			video: `${ASSET_PATH}${processedVideoName}`,
			width: data.width,
			height: data.height,
		};

		return `export default ${JSON.stringify(results)}`;
	})().then((res) => callback(undefined, res), (err) => callback(err));
};

module.exports.raw = true;
