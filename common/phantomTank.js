/**
 * 幻影坦克运算内核：纯函数，不含任何 uni API、DOM 或平台判断。
 * 输入输出统一是 { width, height, data }，data 为 RGBA 的 Uint8ClampedArray，
 * 这样各端的差异全部留在 phantomTankAdapter 里。
 *
 * 原理（非预乘 RGBA，合成公式 visible = F*a + (1-a)*bg）：
 *   黑底 bg=0   : B = F*a
 *   白底 bg=255 : W = F*a + (1-a)*255
 *   两式相减    : W - B = (1-a)*255
 * 于是每个像素可以由两张图的目标值反解：
 *   a   = 255 - (W - B)        （clamp 到 [0,255]）
 *   F_c = B_c * 255 / a        （a == 0 时该像素全透明）
 *
 * 两个由公式推出、决定行为的关键点：
 * 1. 要求每个像素 W >= B。违反时 a 被上钳到 255，该像素完全不透明，
 *    白底看起来退化成黑底那张图——这就是 stats.clamped（“压平”）。
 * 2. alpha 每像素只有一个而 RGB 有三个通道，要两张图都精确还原，
 *    必须要求三通道的 W-B 相等。所以灰度模式（两张图先转灰度）能精确还原，
 *    彩色模式只能保证黑底图颜色准确，白底图会变成黑底图加一个固定亮度偏移。
 */

import { EDGE_HARD, LUMA_R, LUMA_G, LUMA_B, clamp255, planSize, coverRect, composite } from './imageGeometry.js'

// 几何/合成/亮度这些两个坦克都要用的纯函数已经搬到 imageGeometry.js，
// 这里原样再导出一次，页面那边的 import 一个字都不用改。
export { planSize, coverRect, composite }

export const LIMITS = {
	edgeOptions: [720, 1080, 1440],
	edgeDefault: 1080,
	// 硬上限：微信端 canvasGetImageData 有约 2000×2000 的内存 OOM 反馈
	edgeHard: EDGE_HARD,
	// 亮度滑块用整数档位（除以 gainScale 使用）：
	// 小程序 slider 的 step 用小数有被取整的风险
	gainScale: 100,
	gainStep: 5,
	// 白底可见的那张（表图）保持原样，全对比度精确还原
	gainWhiteRange: [50, 150],
	gainWhiteDefault: 100,
	// 黑底可见的那张（里图）默认压到 0.30 —— 这是这类工具的标准做法。
	// 因为 255 - alpha = W - B：不压暗时两张中灰照片的差接近 0，两个底看起来
	// 就是一样的；压到 0.3 后差值约 90，效果明显。代价是黑底那张整体变暗。
	gainBlackRange: [10, 150],
	gainBlackDefault: 30
}

function clampGain(value, range, fallback) {
	const min = range[0] / LIMITS.gainScale
	const max = range[1] / LIMITS.gainScale
	const gain = Number(value)
	if (!isFinite(gain) || gain <= 0) return fallback / LIMITS.gainScale
	if (gain < min) return min
	if (gain > max) return max
	return gain
}

/**
 * 编码：两张同尺寸的图 -> 一张幻影坦克图。
 * onWhite 是白底可见的那张，onBlack 是黑底可见的那张。
 * options: { grayscale = true, invertWhite, invertBlack, gainWhite = 1, gainBlack = 1 }
 */
export function encode({ onWhite, onBlack, options = {} }) {
	if (!onWhite || !onBlack || !onWhite.data || !onBlack.data) {
		throw new Error('需要两张图片的像素数据')
	}
	if (onWhite.width !== onBlack.width || onWhite.height !== onBlack.height) {
		throw new Error(
			'两张图尺寸不一致：' +
				onWhite.width + 'x' + onWhite.height +
				' 与 ' + onBlack.width + 'x' + onBlack.height
		)
	}

	const width = onWhite.width
	const height = onWhite.height
	const total = width * height
	const grayscale = options.grayscale !== false
	const invertWhite = !!options.invertWhite
	const invertBlack = !!options.invertBlack
	const gainWhite = clampGain(options.gainWhite, LIMITS.gainWhiteRange, LIMITS.gainWhiteDefault)
	const gainBlack = clampGain(options.gainBlack, LIMITS.gainBlackRange, LIMITS.gainBlackDefault)

	const white = onWhite.data
	const black = onBlack.data
	const out = new Uint8ClampedArray(total * 4) // 全透明像素的 RGB 保持 0，无需额外处理

	let clamped = 0
	let alphaZero = 0
	let opaque = 0
	let alphaMin = 255
	let alphaMax = 0
	let alphaSum = 0
	let diffSum = 0

	for (let i = 0, p = 0; i < total; i++, p += 4) {
		let wr = white[p] * gainWhite
		let wg = white[p + 1] * gainWhite
		let wb = white[p + 2] * gainWhite
		if (invertWhite) {
			wr = 255 - wr
			wg = 255 - wg
			wb = 255 - wb
		}
		let br = black[p] * gainBlack
		let bg = black[p + 1] * gainBlack
		let bb = black[p + 2] * gainBlack
		if (invertBlack) {
			br = 255 - br
			bg = 255 - bg
			bb = 255 - bb
		}

		wr = clamp255(wr)
		wg = clamp255(wg)
		wb = clamp255(wb)
		br = clamp255(br)
		bg = clamp255(bg)
		bb = clamp255(bb)

		// alpha 每像素只有一个，RGB 三通道共用
		const whiteLuma = LUMA_R * wr + LUMA_G * wg + LUMA_B * wb
		const blackLuma = LUMA_R * br + LUMA_G * bg + LUMA_B * bb
		let alpha
		if (grayscale) {
			// 灰度输出：alpha 必须由亮度差决定，白底那张才能精确还原
			alpha = 255 - whiteLuma + blackLuma
		} else {
			// 彩色：三通道各算 d_c = 255 - W_c + B_c 再取加权均值（参考实现的做法），
			// 下界夹到 max(B_c)，保证 F_c = B_c * 255 / alpha 不会超过 255
			alpha = 0.334 * (255 - wr + br) + 0.333 * (255 - wg + bg) + 0.333 * (255 - wb + bb)
			const floor = Math.max(br, bg, bb)
			if (alpha < floor) alpha = floor
		}
		if (alpha > 255) {
			// 白底比黑底还暗：物理上还原不了，只能压平（该点变成不透明）
			alpha = 255
			clamped++
		} else if (alpha < 0) {
			alpha = 0
		}

		// 255 - alpha 正好是「同一个像素在白底和黑底下的亮度差」，
		// 也就是两个预览看起来差多少——这才是效果强度的真实度量
		diffSum += 255 - alpha
		alphaSum += alpha
		if (alpha < alphaMin) alphaMin = alpha
		if (alpha > alphaMax) alphaMax = alpha
		// alpha == 255 的像素在哪个底上都一样，等于没效果；alpha == 0 的像素
		// 两个底上都是纯背景色，也没有信息。剩下的才是「有效像素」。
		if (alpha === 255) opaque++
		if (alpha === 0) {
			alphaZero++
			continue
		}

		const k = 255 / alpha
		if (grayscale) {
			const value = blackLuma * k
			out[p] = value
			out[p + 1] = value
			out[p + 2] = value
		} else {
			out[p] = br * k
			out[p + 1] = bg * k
			out[p + 2] = bb * k
		}
		out[p + 3] = alpha
	}

	return {
		width,
		height,
		data: out,
		stats: {
			total,
			clamped,
			alphaZero,
			opaque,
			alphaMin,
			alphaMax,
			alphaMean: total ? alphaSum / total : 0,
			// 两个底下的平均亮度差（0~255），这才是效果强度的真实度量：
			// 小于 10 基本看不出来，大于 40 就非常明显了
			meanDiff: total ? diffSum / total : 0,
			clampedRatio: total ? clamped / total : 0,
			opaqueRatio: total ? opaque / total : 0,
			transparentRatio: total ? alphaZero / total : 0
		}
	}
}

/**
 * 统计一张 RGBA 图的 alpha 分布，用于自检。
 * 把「导出后的 PNG」读回来量一次，就能判断透明通道是编码阶段就没产生，
 * 还是在导出阶段被平台丢掉了——这两种原因的修法完全不同。
 */
export function measureAlpha(image) {
	if (!image || !image.data) throw new Error('缺少像素数据')
	const data = image.data
	const total = image.width * image.height
	let min = 255
	let max = 0
	let sum = 0
	let notOpaque = 0

	for (let p = 0; p < total; p++) {
		const alpha = data[p * 4 + 3]
		if (alpha < min) min = alpha
		if (alpha > max) max = alpha
		sum += alpha
		if (alpha < 255) notOpaque++
	}

	return {
		total,
		min,
		max,
		mean: total ? sum / total : 0,
		notOpaque,
		notOpaqueRatio: total ? notOpaque / total : 0
	}
}
