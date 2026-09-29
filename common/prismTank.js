/**
 * 光棱坦克运算内核：纯函数，不含任何 uni API、DOM 或平台判断。
 * 输入输出统一是 { width, height, data }，data 为 RGBA 的 Uint8ClampedArray，
 * 端差异全部留在 imagePlatform.js 里。
 *
 * 和幻影坦克的区别：幻影坦克把两张图的差藏进 **alpha 通道**（所以必须是带透明的 PNG、
 * 换个背景色就换一张脸）；光棱坦克把两张图藏进**亮度色阶**，输出是**不透明**的。
 *
 * 原理（棋盘格交错 + 亮度带分离）：
 *   1. 把两张同尺寸的图按棋盘格交错采样到同一张图上：
 *      (x + y) 为偶数的像素放表图（正常可见的那张），奇数放里图（要藏的那张）。
 *   2. 表图的像素被压进高亮度带 [coverThreshold, 255]，里图的压进低亮度带 [0, innerThreshold]。
 *   3. 正常观看时里图那半像素表现为一层暗色噪点，人眼只看得到表图。
 *      把曝光/亮度拉高（等价于把 [0, innerThreshold] 拉伸回 [0, 255]），里图就显现出来。
 *
 * 三个由公式推出、决定行为的关键点：
 *
 * 1. **innerThreshold < coverThreshold 是硬约束**。编码后表图像素亮度恒 >= coverThreshold、
 *    里图像素恒 <= innerThreshold，两者不重叠是「不靠任何启发式就能按亮度带区分两张图」的
 *    充分必要条件。一旦重叠，显形会连表图的像素一起拉伸，两张图糊在一起。
 *
 * 2. **棋盘格让两张图各只占一半像素**，等效于对角采样，线性分辨率约降到 1/√2。
 *    两张图都变糊，这是原理决定的，不是实现问题。
 *
 * 3. **里图带内只有 (innerThreshold + 1) 级**（默认 25 级），显形时整段拉回 256 级，
 *    于是每一级都被放大成 255/innerThreshold ≈ 10.6 级，量化误差是对称的 ±半格
 *    （实测里图位 RMSE 约 3.05，正好是 10.625/sqrt(12)）。**但这不是画质瓶颈** ——
 *    真正的大头是表图那半像素得靠邻居补出来。别指望调色阶端追画质。
 *
 * 色阶映射的四个分支可以合并成一个式子（offset + v * k 再取整）：
 *   表图：k = (255 - t) / 255，非反相 offset = t，反相 offset = 0
 *   里图：k = t / 255，      非反相 offset = 0，反相 offset = 255 - t
 * 反相（isReverse）就是把两者的亮度带对调：表图落 [0, 255-t]、里图落 [255-t, 255]。
 *
 * 参考实现（MIT）。编码和显形都是**照搬它的真实算法**，没有自行改动：
 *   https://github.com/TankFactory/Mirage_Decode
 *   - 编码   web/src/services/process/fallback/encode.ts
 *   - 显形   web/src/services/process/webgl/decode.ts    ← 它的主路径（scaleFS + fillFS 两段式）
 *   - 参数   web/src/constants/default-arg.ts
 *   - 元数据 web/src/services/metadata/png.ts            ← tEXt 块的读写
 *
 * 注意它的 CPU 回退路径（process/fallback/decode.ts）里的单遍 ltavg **不是**它的主算法，
 * 那是为了在没有 WebGL 时还能出图而写的最低配版本，实测比主算法差约 2 dB。别照那条抄。
 */

import { clamp255, LUMA_R, LUMA_G, LUMA_B } from './imageGeometry.js'

export const LIMITS = {
	edgeOptions: [720, 1080, 1440],
	// 比幻影坦克的 1080 小：光棱坦克一次生成要跑 3 次 PNG 编码（合成图 + 模拟显形的两份），
	// pngWriter 的 deflate 是大头，而且棋盘格本来就让有效分辨率减半
	edgeDefault: 720,
	edgeHard: 1600,

	// 表图色阶端：表图被压进 [t, 255]
	coverThresholdDefault: 42,
	coverThresholdRange: [4, 254],
	// 里图色阶端：里图被压进 [0, t]。参考实现 encode/decode 两边的默认值都是 24
	innerThresholdDefault: 24,
	innerThresholdRange: [1, 254],

	thresholdStep: 1,

	// 对比度。制作时**分别作用在两张源图上**（低对比度的里图提上来才用得好那条窄带，
	// 这是显形质量的主要来源之一）；显形时作用在结果上，把制作时提的对比度还原回去。
	// 两者是**反向**的：制作加了 C，显形就减 C，见 decodePreset 的注释。
	// 范围 / 步长 / 默认值照搬参考实现
	contrastRange: [-255, 255],
	contrastStep: 5,
	contrastDefault: 0,

	// 交错参数：铺成什么花样，范围照搬参考实现的界面（斜率 0~4、间隔 1~4、按行还是按列）。
	// 默认 slope=1 / gap=1 / isRow=true 就是标准棋盘格。
	// **只有间隔 > 1 时扩散迭代次数才有意义** —— 那时才会有覆盖像素在第一轮找不到带内邻居。
	slopeRange: [0, 4],
	gapRange: [1, 4],
	slopeDefault: 1,
	gapDefault: 1,

	// 显形时落在阈值区间之外的像素（即表图那半）怎么处理。
	// 默认的 ltavg 就是参考实现 WebGL 路径的做法：掩码驱动 + 24 邻域高斯加权的扩散填充
	methodOptions: ['ltavg', 'white', 'black', 'transparent'],
	methodDefault: 'ltavg',
	// 扩散填充的轮数。标准棋盘格第一轮就把该填的填完了，之后每轮没有任何改动会提前退出，
	// 所以这个值只对 gap>1 这类非标准交错才有意义（参考实现默认 16、上限 100）
	iterationsDefault: 16,
	maxIterations: 100
}

// 显形阈值的默认值与里图色阶端的默认值必须一致，否则选完图不调参数就显不出里图
export const DECODE_LOWER_DEFAULT = 0
export const DECODE_HIGHER_DEFAULT = LIMITS.innerThresholdDefault

function clampInt(value, range, fallback) {
	const number = Math.round(Number(value))
	if (!isFinite(number)) return fallback
	if (number < range[0]) return range[0]
	if (number > range[1]) return range[1]
	return number
}

/**
 * 交错判定：这个像素归表图还是里图。照搬参考实现的 encodeIsCover。
 *
 * 默认 slope=1 / gap=1 / isRow=true 就是标准棋盘格 `(y / 1 + x) % 2 < 1`，
 * 也就是 (x+y) 为偶数的格子给表图，两张图各占一半像素。
 *
 * - slope：斜向。0 表示不斜（一整行/一整列地切），1 以上会把条纹压斜成一个角度。
 * - gap：间隔。条纹占 gap 格、空 1 格，所以里图占比是 1/(gap+1)，gap=1 时正好一半。
 * - isRow：条纹沿行还是沿列铺。
 *
 * 里图占比 = 1/(gap+1)，显形那边的「落带比例」诊断就按这个来算。
 */
export function isCover(x, y, slope, gap, isRow) {
	const s = slope === undefined ? LIMITS.slopeDefault : slope
	const g = gap === undefined ? LIMITS.gapDefault : gap
	const row = isRow === undefined ? true : isRow

	if (s === 0) return (row ? y : x) % (g + 1) < g
	if (row) return (y / s + x) % (g + 1) < g
	return (x / s + y) % (g + 1) < g
}

/** 里图应该占的像素比例。显形诊断和 stats 都用它当期望值。 */
export function innerRatioFor(gap) {
	const g = gap === undefined ? LIMITS.gapDefault : gap
	return 1 / (g + 1)
}

/**
 * 落带比例对不对得上"某个合理的间隔"。间隔 1~4 分别对应 50% / 33% / 25% / 20%。
 *
 * 容差 0.04 和 detectDecodeRange 里的一致 —— 像素是离散的，`(x+y)%3` 这种交错在长宽
 * 不整除 3 的图上只占 33.2% 而不是 33.33%，卡死会误判。
 *
 * 这是个很灵敏的判据：阈值框对的时候这个比例**精确等于** 1/(间隔+1)；
 * 一旦对不上，说明阈值明显没框对（或者图被整体改过）。
 */
export function isPlausibleInnerRatio(ratio) {
	for (let g = LIMITS.gapRange[0]; g <= LIMITS.gapRange[1]; g++) {
		if (Math.abs(ratio - innerRatioFor(g)) <= 0.04) return true
	}
	return false
}

/**
 * 从图本身反推显形阈值 —— 不依赖元数据、不依赖会话状态。
 *
 * 为什么需要它：阈值本来只来自两个地方，都不可靠 ——
 *  1. PNG 的 tEXt 块（别的工具做的图、被压过的图、平台抹掉元数据的图都读不到；
 *     各端读文件的 API 差异很大，失败时只能静默返回 null）
 *  2. 同一次会话内的预填（重开应用就没了）
 * 阈值一旦没对上，症状是**里图里较亮的区域整片掉出亮度带**，那些位置被当成表图去插值，
 * 于是显形结果里出现一块一块的糊斑 —— 实测掉带位锐度 0.28、正常位 3.25，一眼就能看出来。
 *
 * 原理（非反相）：里图恒在 [0, t]、表图恒在 [T, 255] 且 T > t，里图占 1/(间隔+1) 的像素。
 * 于是「亮度 <= h 的像素占到 1/(间隔+1)」这个条件恰好在 h = 里图最大亮度处成立，
 * 而它 <= t < T，所以这个 h 既能把里图**一个不漏**地圈住，又不会碰到任何表图像素。
 * 反相对称。
 *
 * 间隔不知道怎么办：**数上沿外侧的空档**。框对的时候 h 的上面必然有一段连续空档
 * （从 t 到 T 之间没有任何像素），而用错的间隔算出来的 h 会落进表图那一坨里、
 * 上面紧接着就有像素。所以把 1~4 四种间隔各试一遍，取空档最长的那个。
 * 间隔 1 是默认、也是绝大多数图，同分时优先它。
 *
 * 对不是光棱坦克的普通图片，它会退化成"取中位数"、空档长度为 0，没有意义 ——
 * 调用方要拿 stats.innerRatio 复核（框对时应当精确等于 1/(间隔+1)）。
 */
export function detectDecodeRange(image, isReverse, gap) {
	if (!image || !image.data) return null
	const total = image.width * image.height
	if (!total) return null

	const hist = new Float64Array(256)
	const data = image.data
	for (let p = 0; p < data.length; p += 4) {
		const luma = LUMA_R * data[p] + LUMA_G * data[p + 1] + LUMA_B * data[p + 2]
		hist[luma < 0 ? 0 : luma > 255 ? 255 : Math.round(luma)]++
	}

	// 从这个档位往外数，连续有多少档是空的
	const emptyRun = (level) => {
		let run = 0
		if (!isReverse) {
			for (let i = level + 1; i < 256 && hist[i] === 0; i++) run++
		} else {
			for (let i = level - 1; i >= 0 && hist[i] === 0; i--) run++
		}
		return run
	}

	// 指定了间隔就只用它；没指定就把 1~4 都当候选，同分时取先在的（也就是间隔小的）。
	// 数组顺序就是优先顺序
	const candidates = []
	if (gap === undefined) {
		for (let g = LIMITS.gapRange[0]; g <= LIMITS.gapRange[1]; g++) {
			candidates.push({ gap: g, fraction: innerRatioFor(g) })
		}
	} else {
		const g = clampInt(gap, LIMITS.gapRange, LIMITS.gapDefault)
		candidates.push({ gap: g, fraction: innerRatioFor(g) })
	}

	// 占比的容差。**不能卡死在精确的 1/(间隔+1) 上**：像素是离散的，
	// (x+y)%3 这种交错在长宽不整除 3 的图上只占到 33.2% 而不是 33.33%，
	// 卡死了边界就会越过里图那一簇、落进表图里（实测踩过，gap=2 直接失效）。
	const tolerance = 0.04

	let best = null
	let cumulative = 0
	for (let step = 0; step < 256; step++) {
		const level = isReverse ? 255 - step : step
		cumulative += hist[level]
		const fraction = cumulative / total

		let matched = null
		for (let i = 0; i < candidates.length; i++) {
			if (Math.abs(fraction - candidates[i].fraction) <= tolerance) {
				matched = candidates[i]
				break
			}
		}
		if (!matched) continue

		// 空档越长越说明这个占比正好切在里图带的上沿
		const run = emptyRun(level)
		if (!best || run > best.emptyRun) best = { boundary: level, emptyRun: run, gap: matched.gap }
	}

	// 兜底：一档都没落进容差（极端情况，比如整张图只有一种亮度，累计占比从 0 直接跳到 1），
	// 就取最接近目标占比的那一档。空档记 0，调用方据此提示"这大概不是光棱坦克图"。
	if (!best) {
		let running = 0
		let closest = null
		for (let step = 0; step < 256; step++) {
			const level = isReverse ? 255 - step : step
			running += hist[level]
			const distance = Math.abs(running / total - candidates[0].fraction)
			if (!closest || distance < closest.distance) {
				closest = { distance: distance, boundary: level, gap: candidates[0].gap }
			}
		}
		best = { boundary: closest.boundary, emptyRun: 0, gap: closest.gap }
	}

	return {
		lower: isReverse ? best.boundary : 0,
		higher: isReverse ? 255 : best.boundary,
		isReverse: !!isReverse,
		// 反推出的间隔，以及边界外侧的空档长度。
		// **空档为 0 说明这张图很可能根本不是光棱坦克**，调用方要据此提示用户
		gap: best.gap,
		emptyRun: best.emptyRun
	}
}

/**
 * 归一化并校验编码参数。不抛错，把问题记在 errors 里，把可直接使用的值放在 normalized。
 *
 * 两个色阶端交叉时，除了记错误，还会把里图色阶端压到 coverThreshold - 1：
 * 这样即便调用方忽略了 errors，产出的图仍然是能显形的，不至于得到一张废图。
 *
 * options: { coverThreshold, innerThreshold, isReverse, coverGray = true, innerGray = false }
 */
export function validateEncodeOptions(options) {
	const raw = options || {}
	const errors = []

	const coverThreshold = clampInt(raw.coverThreshold, LIMITS.coverThresholdRange, LIMITS.coverThresholdDefault)
	const innerThreshold = clampInt(raw.innerThreshold, LIMITS.innerThresholdRange, LIMITS.innerThresholdDefault)
	// 参考实现的默认值是表图转灰度、里图不转
	const isReverse = !!raw.isReverse
	const coverGray = raw.coverGray !== false
	const innerGray = raw.innerGray === true

	let safeInner = innerThreshold
	if (safeInner >= coverThreshold) {
		errors.push(
			'里图色阶端（' + innerThreshold + '）必须小于表图色阶端（' + coverThreshold + '），' +
			'否则两张图的亮度带会重叠'
		)
		safeInner = Math.max(LIMITS.innerThresholdRange[0], coverThreshold - 1)
	}

	return {
		valid: errors.length === 0,
		errors,
		normalized: {
			coverThreshold,
			innerThreshold: safeInner,
			isReverse,
			coverGray,
			innerGray,
			innerContrast: clampInt(raw.innerContrast, LIMITS.contrastRange, LIMITS.contrastDefault),
			coverContrast: clampInt(raw.coverContrast, LIMITS.contrastRange, LIMITS.contrastDefault),
			slope: clampInt(raw.slope, LIMITS.slopeRange, LIMITS.slopeDefault),
			gap: clampInt(raw.gap, LIMITS.gapRange, LIMITS.gapDefault),
			// 参考实现的 radio 默认是「按行」
			isRow: raw.isRow === undefined ? true : !!raw.isRow
		}
	}
}

/**
 * 编码：两张同尺寸的图 -> 一张光棱坦克图。
 * cover 是表图（正常可见），inner 是里图（隐藏）。alpha 从各自源图直接透传。
 *
 * 每个像素的处理顺序照搬参考实现：**先转灰度、再调对比度、最后压进亮度带**。
 * 对比度是给低对比度的源图用的 —— 里图本来就只有 t+1 级可用，不提对比度的话
 * 细节会挤成一团；提上来之后那条窄带才用得满。
 *
 * options: {
 *   coverThreshold, innerThreshold, isReverse,
 *   coverGray = true, innerGray = false,
 *   innerContrast = 0, coverContrast = 0,
 *   slope = 1, gap = 1, isRow = true
 * }
 */
export function encode({ cover, inner, options = {} }) {
	if (!cover || !inner || !cover.data || !inner.data) {
		throw new Error('需要两张图片的像素数据')
	}
	if (cover.width !== inner.width || cover.height !== inner.height) {
		throw new Error(
			'两张图尺寸不一致：' +
				cover.width + 'x' + cover.height +
				' 与 ' + inner.width + 'x' + inner.height
		)
	}

	const { valid, errors, normalized } = validateEncodeOptions(options)
	if (!valid) throw new Error(errors.join('；'))
	const {
		coverThreshold, innerThreshold, isReverse, coverGray, innerGray,
		innerContrast, coverContrast, slope, gap, isRow
	} = normalized

	const width = cover.width
	const height = cover.height
	const total = width * height
	const out = new Uint8ClampedArray(total * 4)
	const coverData = cover.data
	const innerData = inner.data

	// 四个映射分支合并成 offset + v * k，循环里只做一次乘法和取整。
	// 取值域：表图非反相 v=255 时 t + 255*(255-t)/255 = 255；里图反相 v=255 时 255-t+t = 255。
	// 都是 [0, 255] 内的整数，所以不需要 clamp。
	//
	// **取整必须用 Math.round，不能用 Math.floor。** 参考实现两条编码路径在这里不一致：
	// 回退路径的 scaleWrap 用 floor，而 WebGL 路径的着色器在归一化空间算完写回 8 位纹理，
	// GPU 的 float->unorm8 是**四舍五入**。有 WebGL2 的设备走的是后者（ImageProcess 只有
	// initImageProcess() 成功才切到 WebGL），所以 round 才是参考实现的实际行为。
	// 曾经照抄了回退路径的 floor，实测 36% 的通道比着色器低 1 级 —— 里图那半像素显形时
	// 被放大 10.6 倍，整张会偏暗约 4 级。第 20 节盯着这个。
	const coverOffset = isReverse ? 0 : coverThreshold
	const coverK = (255 - coverThreshold) / 255
	const innerOffset = isReverse ? 255 - innerThreshold : 0
	const innerK = innerThreshold / 255

	// 对比度不调时留 null 而不是 0 —— contrast = -255 的系数**正好是 0**，
	// 那是个合法取值（整张压成中灰），拿 0 当哨兵会把"没调"和"调到最狠"搞混
	const coverFactor = coverContrast === 0 ? null : contrastFactor(coverContrast)
	const innerFactor = innerContrast === 0 ? null : contrastFactor(innerContrast)

	let coverPixels = 0
	let innerPixels = 0
	let coverMin = 255
	let coverMax = 0
	let innerMin = 255
	let innerMax = 0

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const p = (y * width + x) * 4

			if (isCover(x, y, slope, gap, isRow)) {
				let r = coverData[p]
				let g = coverData[p + 1]
				let b = coverData[p + 2]
				if (coverGray) {
					// 参考实现是先整张转灰度再调对比度，而写进 Uint8ClampedArray 时会取整，
					// 所以这里每步都取整，保证逐像素结果一致
					const gray = Math.round(LUMA_R * r + LUMA_G * g + LUMA_B * b)
					r = gray
					g = gray
					b = gray
				}
				if (coverFactor !== null) {
					r = Math.round(applyContrastChannel(r, coverFactor))
					g = Math.round(applyContrastChannel(g, coverFactor))
					b = Math.round(applyContrastChannel(b, coverFactor))
				}
				const or = Math.round(coverOffset + r * coverK)
				const og = Math.round(coverOffset + g * coverK)
				const ob = Math.round(coverOffset + b * coverK)
				out[p] = or
				out[p + 1] = og
				out[p + 2] = ob
				out[p + 3] = coverData[p + 3]

				coverPixels++
				const luma = LUMA_R * or + LUMA_G * og + LUMA_B * ob
				if (luma < coverMin) coverMin = luma
				if (luma > coverMax) coverMax = luma
			} else {
				let r = innerData[p]
				let g = innerData[p + 1]
				let b = innerData[p + 2]
				if (innerGray) {
					const gray = Math.round(LUMA_R * r + LUMA_G * g + LUMA_B * b)
					r = gray
					g = gray
					b = gray
				}
				if (innerFactor !== null) {
					r = Math.round(applyContrastChannel(r, innerFactor))
					g = Math.round(applyContrastChannel(g, innerFactor))
					b = Math.round(applyContrastChannel(b, innerFactor))
				}
				const or = Math.round(innerOffset + r * innerK)
				const og = Math.round(innerOffset + g * innerK)
				const ob = Math.round(innerOffset + b * innerK)
				out[p] = or
				out[p + 1] = og
				out[p + 2] = ob
				out[p + 3] = innerData[p + 3]

				innerPixels++
				const luma = LUMA_R * or + LUMA_G * og + LUMA_B * ob
				if (luma < innerMin) innerMin = luma
				if (luma > innerMax) innerMax = luma
			}
		}
	}

	return {
		width,
		height,
		data: out,
		stats: {
			total,
			coverPixels,
			innerPixels,
			// 里图该占的比例。显形那边就是拿它当判据的期望值
			expectedInnerRatio: innerRatioFor(gap),
			// 表图区域实测的亮度范围，理论上恒在 [coverThreshold, 255]（非反相）
			coverMin,
			coverMax,
			// 里图区域实测的亮度范围，理论上恒在 [0, innerThreshold]（非反相）
			innerMin,
			innerMax,
			// 两个亮度带之间空出来的级数，就是可解码裕度
			separation: coverThreshold - innerThreshold,
			coverThreshold,
			innerThreshold,
			isReverse,
			coverGray,
			innerGray,
			innerContrast,
			coverContrast,
			slope,
			gap,
			isRow
		}
	}
}

/**
 * 由制作参数推出显形时该用的阈值区间。
 * 等价于参考实现 decodePreset 里对阈值那两位十六进制的处理：
 * 非反相时里图落 [0, t]，反相时落 [255 - t, 255]。
 */
export function predictDecodeRange(isReverse, innerThreshold) {
	const t = clampInt(innerThreshold, LIMITS.innerThresholdRange, LIMITS.innerThresholdDefault)
	if (isReverse) return { lower: 255 - t, higher: 255 }
	return { lower: 0, higher: t }
}

/**
 * 归一化显形参数。区间为空（higher <= lower）不算错误 —— 参考实现的行为是整张输出黑色，
 * 这里保持一致，只把结果记在 valid 里让页面去提示。
 *
 * iterations 和 contrast 目前不暴露给界面：前者对标准棋盘格没有影响，后者只来自图片元数据
 * （用来正确显示别的工具做的图）。
 */
export function normalizeDecodeOptions(options) {
	const raw = options || {}
	const lower = clampInt(raw.lower, [0, 255], DECODE_LOWER_DEFAULT)
	const higher = clampInt(raw.higher, [0, 255], DECODE_HIGHER_DEFAULT)
	const method = LIMITS.methodOptions.indexOf(raw.method) === -1 ? LIMITS.methodDefault : raw.method
	const iterations = clampInt(
		raw.iterations === undefined ? LIMITS.iterationsDefault : raw.iterations,
		[0, LIMITS.maxIterations],
		LIMITS.iterationsDefault
	)
	const contrast = clampInt(raw.contrast, [-255, 255], 0)
	// 锐化填充：默认关，开了才换权重表。只对 ltavg 有意义
	const sharpenFill = method === 'ltavg' && !!raw.sharpenFill

	return {
		lower,
		higher,
		method,
		iterations,
		contrast,
		sharpenFill,
		valid: higher > lower,
		errors: higher > lower ? [] : ['阈值上界（' + higher + '）必须大于下界（' + lower + '）']
	}
}

// ---------------------------------------------------------------- 带外像素的三样直填

function fillCoverBlack(out, i) {
	out[i] = 0
	out[i + 1] = 0
	out[i + 2] = 0
	out[i + 3] = 255
}

function fillCoverWhite(out, i) {
	out[i] = 255
	out[i + 1] = 255
	out[i + 2] = 255
	out[i + 3] = 255
}

function fillCoverTransparent(out, i) {
	out[i] = 0
	out[i + 1] = 0
	out[i + 2] = 0
	out[i + 3] = 0
}

// ---------------------------------------------------------------- 扩散填充（照搬参考实现的 fillFS）

// 24 个邻居偏移（一直到 2 像素远，含对角）与对应的权重，逐条照抄参考实现
// web/src/services/process/webgl/decode.ts 里的 offsets / weights。
// 权重是 exp(-d² / (2σ²))，σ = 1：距离 1 约 0.607，距离 √2 约 0.368，
// 距离 2 约 0.135，距离 √5 约 0.082，距离 2√2 约 0.018。
const FILL_OFFSETS = [
	[-1, 0], [1, 0], [0, -1], [0, 1],
	[-1, -1], [1, 1], [-1, 1], [1, -1],
	[-2, 0], [2, 0], [0, -2], [0, 2],
	[-2, -2], [2, 2], [-2, 2], [2, -2],
	[-1, -2], [1, 2], [-2, -1], [2, 1],
	[-1, 2], [1, -2], [-2, 1], [2, -1]
]

const FILL_WEIGHTS = [
	0.6065, 0.6065, 0.6065, 0.6065,
	0.3679, 0.3679, 0.3679, 0.3679,
	0.1353, 0.1353, 0.1353, 0.1353,
	0.0183, 0.0183, 0.0183, 0.0183,
	0.0821, 0.0821, 0.0821, 0.0821,
	0.0821, 0.0821, 0.0821, 0.0821
]

/**
 * 「锐化填充」用的另一套权重：把距离 1 的四个邻居权重拉到 1，距离 √5 的那八个给**负权重**。
 * 负权重相当于在插值的同时做一次 unsharp —— 那半像素本来就没有高频信息，
 * 用负权重从邻近的已知像素「借」一点高频过来，观感上没那么糊。
 *
 * 这是**有意偏离参考实现**的一套，所以默认不启用（走上面那套原样照搬的权重）。
 * 实测（256px 合成照片，t=24，间隔 1）：
 *   参考权重  填充位 RMSE 5.72，表图位局部锐度 0.94
 *   锐化权重  填充位 RMSE 4.12，表图位局部锐度 1.31（原图是 4.01，仍然补不满）
 * 两项都更好，但**负权重会放大噪声**，被有损压过的图上可能反而更糙，所以交给用户自己决定。
 *
 * 中间那几档（距离 √2 / 2 / 2√2）保持参考实现的高斯值不变：间隔 1 时它们根本取不到
 * （奇偶性和中心相同，是表图），只有 gap>1 的交错才会用到。
 */
const FILL_WEIGHTS_SHARP = [
	1, 1, 1, 1,
	0.3679, 0.3679, 0.3679, 0.3679,
	0.1353, 0.1353, 0.1353, 0.1353,
	0.0183, 0.0183, 0.0183, 0.0183,
	-0.12, -0.12, -0.12, -0.12,
	-0.12, -0.12, -0.12, -0.12
]

function clampIndex(value, limit) {
	return value < 0 ? 0 : value >= limit ? limit - 1 : value
}

/**
 * 跑一轮扩散：每个还没填过的像素，取它周围 24 个邻居里**已经确定**的那些，
 * 按高斯权重加权平均填进去。返回这一轮填掉的像素数。
 *
 * 四处必须照着参考实现做的细节（都是逐行对着 fillFS 抠出来的，别"优化"）：
 * 1. **只累加已经确定的邻居**（对照 shader 里的 neighborMask 判断）。第一轮里"已确定"的
 *    就是真里图像素，所以填出来的值全部来自真实采样，不掺任何猜出来的数。
 * 2. **alpha 也要一起加权**。shader 里累加的是 `vec4 sum`，不是 vec3 —— 只算 RGB、
 *    把 alpha 写死成 255，在有透明区域的图上就和参考实现对不上了。
 * 3. **边界外不跳过，要夹到边上**。shader 没有越界判断，它靠纹理的 CLAMP_TO_EDGE：
 *    越界的采样会取到最边上那个像素，而且**照样计入**权重和。跳过会让最外一圈的结果
 *    和参考实现不同。
 * 4. **双缓冲**。shader 读旧纹理、写新纹理，所以 out 和 mask 都必须先快照；
 *    原地读写会让同一轮里后面的像素读到前面刚写进去的值，图像还会沿扫描方向偏。
 *
 * 标准棋盘格下每个表图像素的上下左右都是里图像素，所以第一轮就全填满了，
 * 之后的轮次一个像素都改不动，调用方据此提前退出。
 */
function fillOnce(out, mask, width, height, weights) {
	const source = out.slice()
	const nextMask = mask.slice()
	let changed = 0

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x
			if (mask[index] === 0) continue

			let r = 0
			let g = 0
			let b = 0
			let a = 0
			let weightSum = 0
			let count = 0

			for (let i = 0; i < FILL_OFFSETS.length; i++) {
				// 夹到边上，不是跳过 —— 见上面第 3 条
				const nx = clampIndex(x + FILL_OFFSETS[i][0], width)
				const ny = clampIndex(y + FILL_OFFSETS[i][1], height)
				const q = ny * width + nx
				if (mask[q] !== 0) continue

				const qp = q * 4
				const weight = weights[i]
				r += source[qp] * weight
				g += source[qp + 1] * weight
				b += source[qp + 2] * weight
				a += source[qp + 3] * weight
				weightSum += weight
				count++
			}

			// 一个确定的邻居都没有就原样留着，下一轮再看（gap 很大时才会出现）。
			// 权重和 <= 0 也要跳过：参考那套权重全为正，这个判断对它永远不成立；
			// 锐化那套有负权重，万一某个像素的可用邻居正好被负权重抵消掉，会算出负数/炸掉。
			if (count === 0 || weightSum <= 0) continue

			const p = index * 4
			out[p] = r / weightSum
			out[p + 1] = g / weightSum
			out[p + 2] = b / weightSum
			out[p + 3] = a / weightSum
			nextMask[index] = 0
			changed++
		}
	}

	mask.set(nextMask)
	return changed
}

/**
 * 对比度系数，公式照搬参考实现的 adjustContrast。contrast 取 -255..255，0 是恒等变换。
 *
 * 编码和显形两边共用这一个公式：制作时对源图施加 +C，显形时对结果施加 -C 还原。
 * 注意 contrast = -255 时系数**正好是 0**（整张压成中灰），是合法取值，
 * 所以调用方不能用 0 当"没设置对比度"的哨兵。
 */
function contrastFactor(contrast) {
	// 归一化后 contrast 最大 255，所以 259 - contrast 不会到 0，不用防除零
	return (259 * (contrast + 255)) / (255 * (259 - contrast))
}

function applyContrastChannel(value, factor) {
	return Math.min(Math.max(0, factor * (value - 128) + 128), 255)
}

/** 对整张 RGBA 就地做对比度调整（显形用；编码是逐通道取值，走上面的 applyContrastChannel） */
function applyContrast(out, contrast) {
	if (contrast === 0) return
	const factor = contrastFactor(contrast)
	for (let p = 0; p < out.length; p += 4) {
		out[p] = applyContrastChannel(out[p], factor)
		out[p + 1] = applyContrastChannel(out[p + 1], factor)
		out[p + 2] = applyContrastChannel(out[p + 2], factor)
	}
}

/**
 * 显形：把落在 [lower, higher] 亮度带里的像素拉伸回全量程（就是里图），
 * 落在带外的（就是表图那半）按 method 处理。
 *
 * 结构和参考实现的两段式一致：
 *   第一遍 = shader 的 scaleFS，带内拉伸、带外填上并打掩码；
 *   之后若干遍 = shader 的 fillFS，把掩码像素扩散填出来（只有 ltavg 走这一段，
 *   黑色/白色/透明在参考实现里就是第一遍直接填完，不迭代）。
 *
 * options: { lower = 0, higher = 24, method = 'ltavg', iterations = 16, contrast = 0 }
 */
export function decode({ image, options = {} }) {
	if (!image || !image.data) throw new Error('缺少像素数据')

	const { lower, higher, method, iterations, contrast, sharpenFill, valid } = normalizeDecodeOptions(options)
	const width = image.width
	const height = image.height
	const total = width * height
	const data = image.data
	const out = new Uint8ClampedArray(total * 4)

	if (!valid) {
		// 阈值区间为空：没有任何像素能被判为里图，整张按表图处理成黑色。
		// 参考实现就是这么做的（不报错），保持行为一致。
		for (let i = 0; i < total; i++) {
			const p = i * 4
			out[p] = 0
			out[p + 1] = 0
			out[p + 2] = 0
			out[p + 3] = data[p + 3]
		}
		return {
			width,
			height,
			data: out,
			stats: {
				total,
				innerPixels: 0,
				coverPixels: total,
				innerRatio: 0,
				lower,
				higher,
				method,
				iterations,
				contrast,
				sharpenFill,
				degenerate: true
			}
		}
	}

	const ratio = 255 / (higher - lower)
	// mask[i] = 1 表示「这个像素是表图，还没被填过」
	const mask = new Uint8Array(total)
	let innerPixels = 0

	for (let i = 0; i < total; i++) {
		const p = i * 4
		const r = data[p]
		const g = data[p + 1]
		const b = data[p + 2]
		const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b

		if (luma >= lower && luma <= higher) {
			out[p] = clamp255((r - lower) * ratio)
			out[p + 1] = clamp255((g - lower) * ratio)
			out[p + 2] = clamp255((b - lower) * ratio)
			out[p + 3] = data[p + 3]
			innerPixels++
			continue
		}

		mask[i] = 1
		// 参考实现的 u_fillMethod 映射是 `black ? 0 : white ? 1 : 2` —— 注意 ltavg 落在
		// 最后的 else 上、和 transparent 一样填**透明**。这个值在填满的情况下会被紧接着的
		// 扩散覆盖掉，但 gap 大、轮数不够时会留下来（参考实现的图上是透明洞），
		// 所以必须和它一致，不能图省事填黑色。
		if (method === 'black') fillCoverBlack(out, p)
		else if (method === 'white') fillCoverWhite(out, p)
		else fillCoverTransparent(out, p)
	}

	if (method === 'ltavg') {
		const weights = sharpenFill ? FILL_WEIGHTS_SHARP : FILL_WEIGHTS
		for (let i = 0; i < iterations; i++) {
			if (fillOnce(out, mask, width, height, weights) === 0) break
		}
	}

	// 对比度放在最后，和参考实现的顺序一致（先 prismDecode，再 adjustContrast）
	if (contrast !== 0) applyContrast(out, contrast)

	return {
		width,
		height,
		data: out,
		stats: {
			total,
			innerPixels,
			coverPixels: total - innerPixels,
			// 这个比例明显偏离 50% 就说明阈值区间没框对
			innerRatio: total ? innerPixels / total : 0,
			lower,
			higher,
			method,
			iterations,
			contrast,
			sharpenFill,
			degenerate: false
		}
	}
}

// ---------------------------------------------------------------- 预设（写进 PNG 的 tEXt 块）

// 5 个字符，和参考实现的格式完全一致：
//   [0]    反相 0/1
//   [1..2] 里图色阶端，两位十六进制
//   [3..4] 对比度压缩后的值（0..100），两位十六进制
// 例 "01832" = 不反相 / 里图色阶端 0x18 = 24 / 对比度压缩值 0x32 = 50（即对比度 0）。
// 对比度那一格存的是**制作时给里图加的那个 C**，显形时按 **-C** 还原：
//   expand(100 - compress(C)) = -C
// 这不是笔误，是刻意的反向闭环：制作时把里图对比度提上去才用得好那条窄带，
// 显形时再压回来，画面才不会过曝。C = 0 时两边都是恒等。
//
// 一处和参考实现的**必要偏差**：它写的是 `contrast.toString(16)`，而 compress 对一般取值
// 会算出小数（compress(5) = 50.98），toString(16) 得到 "32.fae147ae147af"，预设串就超过
// 5 个字符了。它自己的解析是按位切片的，slice(1,3) 会读到 "32" —— 于是阈值被解成 50。
// 也就是说**参考工具只要对比度不是默认值，写出去的元数据就是坏的**。
// 这里四舍五入成整数、保证预设恒为 5 位。这个 bug 不能跟它兼容。

function compressContrast(value) {
	return Math.max(Math.min((value * 50) / 255 + 50, 100), 0)
}

function expandContrast(value) {
	return Math.max(Math.min(((value - 50) * 255) / 50, 255), -255)
}

function hex2(value) {
	const text = Math.round(value).toString(16)
	return text.length >= 2 ? text : '0' + text
}

export function encodePreset(isReverse, innerThreshold, contrast) {
	const threshold = clampInt(innerThreshold, LIMITS.innerThresholdRange, LIMITS.innerThresholdDefault)
	const packed = Math.round(compressContrast(clampInt(contrast, [-255, 255], 0)))
	return (isReverse ? '1' : '0') + hex2(threshold) + hex2(packed)
}

/**
 * 解析参考实现的 5 字符预设。解析不出来返回 null，调用方就退回默认值。
 * 参考实现在字符数不够时会保留原值继续往下走；这里改成能解多少解多少，
 * 页面更好处理（比如只有前 3 位的旧图，就没有对比度信息）。
 */
export function decodePreset(text) {
	if (!text || text.length < 3) return null

	const isReverse = text[0] === '1'
	const threshold = parseInt(text.slice(1, 3), 16)
	// 色阶端为 0 时区间是空的（非反相 [0,0]、反相 [255,255]），显出来只会是一张黑图，
	// 当成解析失败让调用方退回默认值更友好
	if (isNaN(threshold) || threshold < LIMITS.innerThresholdRange[0]) return null

	// 解出来的是**制作时那个 C 的相反数**（展开 100 - packed），也就是显形该施加的对比度，
	// 直接拿去用就行。见 encodePreset 上面那段关于反向闭环的说明。
	let contrast = 0
	if (text.length >= 5) {
		const packed = parseInt(text.slice(3, 5), 16)
		if (!isNaN(packed) && packed >= 0 && packed <= 100) {
			contrast = Math.round(expandContrast(100 - packed))
		}
	}

	return {
		isReverse,
		innerThreshold: threshold,
		lower: isReverse ? 255 - threshold : 0,
		higher: isReverse ? 255 : threshold,
		contrast
	}
}
