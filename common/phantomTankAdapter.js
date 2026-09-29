/**
 * 幻影坦克的平台适配层。
 *
 * 平台代码本身已经搬到 common/imagePlatform.js（光棱坦克也要用同一套），这里只剩一层薄壳：
 * 把画布 id 和文件名前缀这两个与幻影坦克绑定、但平台无关的常量填进去。
 * 这样页面 import 的名字、参数个数、返回值都和以前一模一样，一行都不用改，
 * 模板里的 <canvas id="phantomCanvas"> 也不用动。
 */

import {
	platformName,
	noteError,
	getDiagnostics,
	chooseImages,
	getImageSize,
	savePng,
	readPixels as readPixelsPlatform,
	exportPng as exportPngPlatform,
	releaseImage as releaseImagePlatform
} from './imagePlatform.js'

// 要和 pages/phantom-tank/phantom-tank.vue 模板里那个隐藏画布的 id 一致
const CANVAS_ID = 'phantomCanvas'
// 只用来认出「哪些文件是我们自己写出来的」，回收时据此判断能不能删
const FILE_PREFIX = 'phantom-'

export { platformName, noteError, getDiagnostics, chooseImages, getImageSize, savePng }

export function readPixels(path, target, source, instance) {
	return readPixelsPlatform(path, target, source, instance, CANVAS_ID)
}

export function exportPng(image) {
	return exportPngPlatform(image, FILE_PREFIX)
}

export function releaseImage(src) {
	return releaseImagePlatform(src, FILE_PREFIX)
}
