# WebPack loader to process and load video files

Requires ffmpeg to be installed.

It allows loading video files, gets some basic information from them, and allows some transformations. Currently, it reencodes the video to vp9 lossless.

## Installation

```
npm i video-loader
```

## Result type

The loader returns an object with the following properties:

* ```firstImage```: The path to the first frame of the video (emitted file)
* ```lastImage```: The path to the last frame of the video (emitted file)
* ```numFrames```: The number of frames in the video
* ```video```: The path to the result video file (emitted)
* ```width```: The video width
* ```height```: The video height

## Usage

The easiest way is to use the inline config options of WebPack. To load the video, use:

```
import createUserVideo from "!!video-loader?speed=2.5!./create-user@1.webm";
```

This loads the ```create-user@1.webm```, speeds it up to 2.5x, then returns the result object.

## Configuration

* ```speed```: Speedup the video
* ```ultrafast```: If present, the video is scaled down significantly and the rendering process is a lot faster. Useful when experimenting with the correct options.

## NB!

This is a work-in-progress loader, and I expect some breaking changes when implementing new features.
