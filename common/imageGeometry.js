/**
 * 图片几何与合成的公共纯逻辑：不含任何 uni API、DOM 或平台判断。
 * 输入输出统一是 { width, height, data }，data 为 RGBA 的 Uint8ClampedArray。
 *
 * 从 phantomTank.js 里原样搬出来的，幻影坦克和光棱坦克共用同一套。
 * 幻影坦克那边仍然从 phantomTank.js 里 import 这几个名字（见该文件末尾的 re-export），
 * 所以这次搬家对页面是透明的。
 */

// 微信端 canvasGetImageData 有约 2000×2000 的内存 OOM 反馈，长边统一卡在这里
export const EDGE_HARD = 1600

export const LUMA_R = 0.299
export const LUMA_G = 0.587
export const LUMA_B = 0.114

export function clamp255(value) {
	return value < 0 ? 0 : value > 255 ? 255 : value
}

/**
 * 等比缩放到长边不超过 edge，且不放大（长边已经小于 edge 时原样返回）。
 * 返回的尺寸同时作为两张图的绘制尺寸，保证编码时两张图逐像素对齐。
 */
export function planSize(width, height, edge) {
	if (!width || !height) return { width: 0, height: 0 }
	const limit = Math.min(edge || EDGE_HARD, EDGE_HARD)
	const longEdge = Math.max(width, height)
	if (longEdge <= limit) return { width, height }
	const scale = limit / longEdge
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	}
}

/**
 * 把源图以 cover 方式（等比铺满、居中裁剪）画进目标尺寸时，需要取的源矩形。
 * 第二张图与第一张比例不同时用它裁剪，避免拉伸变形；源矩形由 canvas 自己取，
 * 不需要在 JS 里缩放像素。
 */
export function coverRect(srcW, srcH, dstW, dstH) {
	if (!srcW || !srcH || !dstW || !dstH) return { sx: 0, sy: 0, sw: dstW, sh: dstH }
	const scale = Math.max(dstW / srcW, dstH / srcH)
	const sw = Math.min(srcW, Math.max(1, Math.round(dstW / scale)))
	const sh = Math.min(srcH, Math.max(1, Math.round(dstH / scale)))
	return { sx: Math.round((srcW - sw) / 2), sy: Math.round((srcH - sh) / 2), sw, sh }
}

/**
 * 块平均降采样，长边缩到不超过 maxEdge（已经够小就原样返回）。
 *
 * 给「拖滑块时的实时预览」用：预览只要看得见趋势，用不着全分辨率。
 * **必须是块平均、不能按步长抽样** —— 光棱坦克的合成图是棋盘格，按偶数步长抽样会
 * 整张只取到同一类像素（要么全是表图、要么全是里图），预览就完全是错的。
 * 对已经显形/合成好的普通图做块平均则是常规且安全的。
 */
export function downsampleImage(image, maxEdge) {
	if (!image || !image.data) throw new Error('缺少像素数据')
	const width = image.width
	const height = image.height
	const longEdge = Math.max(width, height)
	if (!maxEdge || longEdge <= maxEdge) return image

	const step = longEdge / maxEdge
	const outWidth = Math.max(1, Math.round(width / step))
	const outHeight = Math.max(1, Math.round(height / step))
	const out = new Uint8ClampedArray(outWidth * outHeight * 4)
	const data = image.data

	for (let y = 0; y < outHeight; y++) {
		const y0 = Math.min(height - 1, Math.floor((y * height) / outHeight))
		const y1 = Math.max(y0 + 1, Math.min(height, Math.floor(((y + 1) * height) / outHeight)))
		for (let x = 0; x < outWidth; x++) {
			const x0 = Math.min(width - 1, Math.floor((x * width) / outWidth))
			const x1 = Math.max(x0 + 1, Math.min(width, Math.floor(((x + 1) * width) / outWidth)))

			let r = 0
			let g = 0
			let b = 0
			let a = 0
			let n = 0
			for (let sy = y0; sy < y1; sy++) {
				const row = sy * width
				for (let sx = x0; sx < x1; sx++) {
					const p = (row + sx) * 4
					r += data[p]
					g += data[p + 1]
					b += data[p + 2]
					a += data[p + 3]
					n++
				}
			}

			const q = (y * outWidth + x) * 4
			out[q] = r / n
			out[q + 1] = g / n
			out[q + 2] = b / n
			out[q + 3] = a / n
		}
	}

	return { width: outWidth, height: outHeight, data: out }
}

/**
 * 把源图以 cover 方式（等比铺满、居中裁剪）缩放到指定尺寸，双线性插值。
 *
 * 逻辑照搬参考实现的 FallbackCommonProcess.resizeCover —— 因为 App 端现在不走 canvas 读像素了，
 * 原来由 canvas 的 9 参 drawImage 完成的裁剪+缩放必须在这里补回来。
 * 尺寸相同就直接复制（常见情况：图本来就是按长边上限存的）。
 */
export function resizeCoverImage(image, width, height) {
	if (!image || !image.data || !width || !height || !image.width || !image.height) return null
	const origWidth = image.width
	const origHeight = image.height
	const origData = image.data

	if (width === origWidth && height === origHeight) {
		return { width, height, data: origData.slice() }
	}

	const origAspect = origWidth / origHeight
	const targetAspect = width / height
	let sampledWidth
	let sampledHeight
	let offsetX = 0
	let offsetY = 0

	if (origAspect > targetAspect) {
		sampledHeight = height
		sampledWidth = Math.max(Math.round(height * origAspect), width)
		offsetX = Math.floor((sampledWidth - width) / 2)
	} else {
		sampledWidth = width
		sampledHeight = Math.max(Math.round(width / origAspect), height)
		offsetY = Math.floor((sampledHeight - height) / 2)
	}

	// 采样跨度为 0（目标尺寸或采样尺寸为 1）时退化成取第一个像素，避免除零
	const spanX = sampledWidth > 1 ? sampledWidth - 1 : 1
	const spanY = sampledHeight > 1 ? sampledHeight - 1 : 1
	const out = new Uint8ClampedArray(width * height * 4)

	for (let y = 0; y < height; y++) {
		const srcY = ((y + offsetY) * (origHeight - 1)) / spanY
		const y0 = Math.floor(srcY)
		const y1 = Math.min(y0 + 1, origHeight - 1)
		const wy = srcY - y0

		for (let x = 0; x < width; x++) {
			const srcX = ((x + offsetX) * (origWidth - 1)) / spanX
			const x0 = Math.floor(srcX)
			const x1 = Math.min(x0 + 1, origWidth - 1)
			const wx = srcX - x0

			const p00 = (y0 * origWidth + x0) * 4
			const p01 = (y0 * origWidth + x1) * 4
			const p10 = (y1 * origWidth + x0) * 4
			const p11 = (y1 * origWidth + x1) * 4
			const target = (y * width + x) * 4

			for (let k = 0; k < 4; k++) {
				out[target + k] =
					(1 - wx) * (1 - wy) * origData[p00 + k] +
					wx * (1 - wy) * origData[p01 + k] +
					(1 - wx) * wy * origData[p10 + k] +
					wx * wy * origData[p11 + k]
			}
		}
	}

	return { width, height, data: out }
}

/**
 * 把带 alpha 的图按指定灰度背景压平（background: 0 = 黑底，255 = 白底），输出不透明图。
 *
 * 光棱坦克的产物本身不透明，这个函数在那边有两个用途：
 * 1. 显影方式选「透明」时，App 端 <image> 不会把父容器的 CSS 背景从 PNG 的透明区域透出来，
 *    所以必须先压平再显示；
 * 2. 不管哪个端，显示用的图都走这条路，渲染层怎么处理 alpha 都影响不到它。
 */
export function composite({ image, background = 255 }) {
	if (!image || !image.data) throw new Error('缺少像素数据')
	const width = image.width
	const height = image.height
	const total = width * height
	const data = image.data
	const out = new Uint8ClampedArray(total * 4)
	const base = clamp255(background)

	for (let i = 0, p = 0; i < total; i++, p += 4) {
		const alpha = data[p + 3] / 255
		const rest = (1 - alpha) * base
		out[p] = alpha * data[p] + rest
		out[p + 1] = alpha * data[p + 1] + rest
		out[p + 2] = alpha * data[p + 2] + rest
		out[p + 3] = 255
	}

	return { width, height, data: out }
}
