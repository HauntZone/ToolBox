/**
 * 光棱坦克的平台适配层。
 *
 * 和 phantomTankAdapter.js 一样只是薄壳：平台代码在 common/imagePlatform.js 里，
 * 这里只填入与光棱坦克绑定的两个常量（画布 id、文件名前缀）。
 */

import {
	platformName,
	noteError,
	getDiagnostics,
	chooseImages,
	getImageSize,
	savePng,
	readFileBytes,
	readPixels as readPixelsPlatform,
	exportPng as exportPngPlatform,
	releaseImage as releaseImagePlatform
} from './imagePlatform.js'

// 要和 pages/tank/prism-tank/prism-tank.vue 模板里那个隐藏画布的 id 一致
const CANVAS_ID = 'prismCanvas'
// 只用来认出「哪些文件是我们自己写出来的」，回收时据此判断能不能删
const FILE_PREFIX = 'prism-'

export { platformName, noteError, getDiagnostics, chooseImages, getImageSize, savePng, readFileBytes }

export function readPixels(path, target, source, instance) {
	return readPixelsPlatform(path, target, source, instance, CANVAS_ID)
}

/** pngText 会被写进 PNG 的 tEXt 块，用来携带显形参数（见 prismTank.js 的 encodePreset） */
export function exportPng(image, pngText) {
	return exportPngPlatform(image, FILE_PREFIX, pngText)
}

export function releaseImage(src) {
	return releaseImagePlatform(src, FILE_PREFIX)
}
