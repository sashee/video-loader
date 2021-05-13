# WebPack loader to process and load video files

Requires ffmpeg to be installed.

It allows loading video files, gets some basic information from them, and allows some transformations. Currently, it reencodes the video to vp9 lossless.

It cuts the video into scenes, defined in the parameters.

## Installation

```
npm i video-loader
```

## Result type

The loader returns an object with the following properties:

* ```firstImage```: The path to the first frame of the video (emitted file)
* ```width```: The video width
* ```height```: The video height
* ```scenes```: an Array containing the files and data for each scene
  * ```lastImage```: The path to the last frame of the scene (emitted file)
  * ```numFrames```: The number of frames in the scene
  * ```duration```: The scene duration in seconds
  * ```video```: The path to the result scene video file (emitted)

## Usage

The easiest way is to use the inline config options of WebPack. To load the video, use:

```
import createUserVideo from "!!video-loader?{scenes: [{end: 4, speed: 2}, {end: 7}, {}], ultrafast_dev: true}!./create-user@1.webm";
```

This loads the ```create-user@1.webm```, then splits it into 3 scenes:

* The first one start from the beginning and ends at the 4-second mark. It is also speed up 2x.
* The second one starts is from 4-7
* The third one start at second 7 and goes to the end of the video

The result is an object, similar to this:

```json
{
	firstImage: "/create-user@1-frame-first-4ca1e05c9e180c5f9b135aa9734cfe81.jpg",
	height: 1080,
	scenes: [
		{
			lastImage: "/create-user@1-scene-0-last-a074c0aa3eb27564b21ab8492c0b4b63.jpg",
			video: "/create-user@1-scene-0-6d3878fd5ef7df210753eb9dd56193cf.webm",
			numFrames: 60,
			duration: 4
		},
		{
			lastImage: "/create-user@1-scene-1-last-2d0808b3d92fa325a04a24f90e74b52f.jpg",
			video: "/create-user@1-scene-1-b0e4545931cdbc842d4cc88ca2ee448a.webm",
			numFrames: 41,
			duration: 2.073
		},
		{
			lastImage: "/create-user@1-scene-2-last-0147e4b0459c8796e4039ce0e0e2236e.jpg",
			video: "/create-user@1-scene-2-ed0421a3de82be35392464ebca473e86.webm",
			numFrames: 105,
			duration: 7
		},
	],
	width: 1920
}
```

## Configuration

* ```scenes```: The scene config. Supports the ```end``` (in seconds, the end of the video if omitted), and the ```speed``` parameters (1, if omitted)
* ```ultrafast_dev```: If present and the NODE_ENV is "development", the video is scaled down significantly and the rendering process is a lot faster. Useful
	for making the render process way faster during development

## NB!

This is a work-in-progress loader, and I expect some breaking changes when implementing new features.
