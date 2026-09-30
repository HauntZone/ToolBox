/**
 * 滑块取值换算：纯逻辑，不含任何 uni API、DOM 或平台判断。
 * 输入输出都是普通数字 / 普通对象，所以能脱离平台验证（见 test/sliderMath.test.mjs）。
 *
 * 抽出来的理由：这几个换算看着简单，实际有两处容易错 ——
 *   1. **浮点尾巴**。对比度是 min=-255 / step=5，本页最边上的合法值是 -255 + 102*5，
 *      二进制浮点算出来是 255.00000000000003 之类的值，直接显示会出现在界面上。
 *   2. **两端必须恰好可达**。阈值这类值是要和编码时的色阶端精确对齐的，如果
 *      "对齐 + 夹紧" 的顺序反了（先夹后对齐），上界就会停在 254 这种地方。
 */

/** 小数点后的位数，用来消浮点尾巴。科学计数法（1e-7）按 0 处理，本项目的取值用不到它 */
function decimalsOf(value) {
	const text = String(value)
	if (text.indexOf('e') >= 0 || text.indexOf('E') >= 0) return 0
	const dot = text.indexOf('.')
	return dot < 0 ? 0 : text.length - dot - 1
}

/**
 * 按步长对齐到最近的档位，再夹回 [min, max]，最后消掉浮点尾巴。
 *
 * 顺序不能换：**先对齐再夹紧**才能保证两端恰好可达。
 * step 非法（0 / 负数 / NaN）时按 1 处理，不让一个坏参数把整行滑块变成 NaN。
 */
export function snapToStep(raw, min, max, step) {
	const low = Math.min(min, max)
	const high = Math.max(min, max)

	let size = Number(step)
	if (!isFinite(size) || size <= 0) size = 1

	let value = Number(raw)
	if (!isFinite(value)) value = low

	const snapped = low + Math.round((value - low) / size) * size
	const clamped = snapped < low ? low : (snapped > high ? high : snapped)

	// 对齐后的值只可能落在 low + k*size 上，所以小数位取两者里更长的那个就够
	const decimals = Math.max(decimalsOf(size), decimalsOf(low))
	return decimals ? Number(clamped.toFixed(decimals)) : Math.round(clamped)
}

/** 值在 [min, max] 里的位置，0 ~ 1，握把和已填充段都按它摆放 */
export function valueToRatio(value, min, max) {
	if (max === min) return 0
	const ratio = (Number(value) - min) / (max - min)
	if (!isFinite(ratio)) return 0
	return ratio < 0 ? 0 : (ratio > 1 ? 1 : ratio)
}

/**
 * 触点横坐标 -> 值。量不到轨道时返回 null，调用方跳过这一帧（绝不算出个 NaN 往界面上写）。
 *
 * **必须传 viewport 相对坐标**（touch 对象的 clientX），因为 rect 来自
 * boundingClientRect，两者同一个坐标系；换成 pageX 会在页面滚动后整体错位。
 */
export function clientXToValue(clientX, rect, min, max, step) {
	if (!rect) return null
	const left = Number(rect.left)
	const width = Number(rect.width)
	if (!isFinite(left) || !isFinite(width) || width <= 0) return null

	const x = Number(clientX)
	if (!isFinite(x)) return null

	const ratio = (x - left) / width
	const bounded = ratio < 0 ? 0 : (ratio > 1 ? 1 : ratio)
	return snapToStep(min + bounded * (max - min), min, max, step)
}
