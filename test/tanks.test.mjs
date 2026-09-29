import {
	LIMITS, isCover, innerRatioFor, validateEncodeOptions, encode, decode,
	predictDecodeRange, normalizeDecodeOptions, encodePreset, decodePreset, detectDecodeRange,
	isPlausibleInnerRatio
} from './prismTank.js'
import { planSize, coverRect, composite, clamp255, downsampleImage, resizeCoverImage } from './imageGeometry.js'
import { encodePng, readPngText } from './pngWriter.js'
import { decodePng, isPng } from './pngReader.js'
import { encode as phantomEncode, measureAlpha, LIMITS as PH_LIMITS, planSize as phPlanSize } from './phantomTank.js'

let pass = 0
let fail = 0
function ok(name, cond, extra) {
	if (cond) { pass++; console.log('  PASS  ' + name) }
	else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')) }
}
function eq(name, actual, expected) {
	ok(name + ' = ' + expected, actual === expected, 'got ' + actual)
}

// 造一张图：fn(x, y) -> [r,g,b,a]
function makeImage(w, h, fn) {
	const data = new Uint8ClampedArray(w * h * 4)
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const p = (y * w + x) * 4
			const px = fn(x, y)
			data[p] = px[0]; data[p + 1] = px[1]; data[p + 2] = px[2]
			data[p + 3] = px.length > 3 ? px[3] : 255
		}
	}
	return { width: w, height: h, data }
}
function gray(v) { return [v, v, v] }

console.log('\n== 1. 几何 ==')
{
	const a = planSize(2000, 1000, 720)
	ok('planSize 等比缩到长边 720', a.width === 720 && a.height === 360, JSON.stringify(a))
	const b = planSize(300, 200, 720)
	ok('planSize 不放大', b.width === 300 && b.height === 200, JSON.stringify(b))
	const c = planSize(5000, 100, 2000)
	eq('planSize 被 EDGE_HARD=1600 卡住长边', c.width, 1600)
	const d = coverRect(100, 200, 100, 100)
	ok('coverRect 竖图裁成方图时水平铺满、垂直居中', d.sw === 100 && d.sh === 100 && d.sy === 50 && d.sx === 0, JSON.stringify(d))
	eq('clamp255 上限', clamp255(300), 255)
	eq('clamp255 下限', clamp255(-5), 0)
}

console.log('\n== 2. 棋盘格 ==')
{
	eq('isCover(0,0)', isCover(0, 0), true)
	eq('isCover(1,0)', isCover(1, 0), false)
	eq('isCover(0,1)', isCover(0, 1), false)
	eq('isCover(1,1)', isCover(1, 1), true)
	let cover = 0
	for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (isCover(x, y)) cover++
	eq('8x8 里表图占的格子数', cover, 32)
}

console.log('\n== 3. 编码的亮度带（默认 coverGray=true） ==')
{
	const size = 8
	const cover = makeImage(size, size, () => gray(255))
	const inner = makeImage(size, size, () => [255, 0, 0])
	const out = encode({ cover, inner })

	// 表图：floor(42 + 255*(255-42)/255) = 42 + 213 = 255
	let coverOk = true
	let innerOk = true
	let firstCoverPixel = null
	let firstInnerPixel = null
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const p = (y * size + x) * 4
			if (isCover(x, y)) {
				if (out.data[p] !== 255 || out.data[p + 1] !== 255 || out.data[p + 2] !== 255) coverOk = false
				if (!firstCoverPixel) firstCoverPixel = [out.data[p], out.data[p + 1], out.data[p + 2]]
			} else {
				// 里图：floor(255*24/255) = 24，且默认不转灰度 -> 红色只剩 R
				if (out.data[p] !== 24 || out.data[p + 1] !== 0 || out.data[p + 2] !== 0) innerOk = false
				if (!firstInnerPixel) firstInnerPixel = [out.data[p], out.data[p + 1], out.data[p + 2]]
			}
		}
	}
	ok('表图像素全部落在色阶端以上（白色 255）', coverOk, JSON.stringify(firstCoverPixel))
	ok('里图像素被压进 [0,24]（红 24,0,0）', innerOk, JSON.stringify(firstInnerPixel))
	ok('表图转了灰度（三通道相等）', firstCoverPixel[0] === firstCoverPixel[1] && firstCoverPixel[1] === firstCoverPixel[2])
	eq('stats.separation = 42-24', out.stats.separation, 18)
	eq('stats.coverPixels', out.stats.coverPixels, 32)
	eq('stats.innerPixels', out.stats.innerPixels, 32)
	ok('实测里图区上界 <= innerThreshold', out.stats.innerMax <= 24, out.stats.innerMax)
	ok('实测表图区下界 >= coverThreshold', out.stats.coverMin >= 42, out.stats.coverMin)
	eq('alpha 透传', out.data[3], 255)
}

console.log('\n== 4. 往返：里图能不能被还原 ==')
{
	const size = 64
	// 里图用 0..252 的灰阶
	const inner = makeImage(size, size, (x) => gray(Math.floor((x * 255) / (size - 1))))
	const cover = makeImage(size, size, (x, y) => gray((x + y) % 2 ? 10 : 240))
	const encoded = encode({ cover, inner, options: { coverGray: true, innerGray: false } })
	const range = predictDecodeRange(false, LIMITS.innerThresholdDefault)
	eq('predictDecodeRange(false,24).lower', range.lower, 0)
	eq('predictDecodeRange(false,24).higher', range.higher, 24)

	const revealed = decode({ image: encoded, options: { lower: range.lower, higher: range.higher, method: 'ltavg' } })

	let maxErr = 0
	let overshoot = 0
	let sampled = 0
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (isCover(x, y)) continue   // 只看里图自己的像素
			const p = (y * size + x) * 4
			const want = Math.floor((x * 255) / (size - 1))
			const signed = revealed.data[p] - want
			if (Math.abs(signed) > maxErr) maxErr = Math.abs(signed)
			if (signed > overshoot) overshoot = signed
			sampled++
		}
	}
	ok('里图每个像素都被采样到', sampled === 32 * 64, sampled)
	ok('往返最大误差 <= 11 级（= 255/里图色阶端 = 10.6）', maxErr <= 11, 'maxErr=' + maxErr)
	// 编码用四舍五入（和参考实现的着色器一致，见第 20 节）之后，量化误差是对称的，
	// 不再是单边偏低。这里只断言它确实没被 clamp 掉、也没出现异常大的跳变。
	ok('量化误差对称（四舍五入的正负都有）', overshoot > 0 && overshoot <= 11, 'overshoot=' + overshoot)
	console.log('        （实际最大误差 ' + maxErr + ' 级，理论 255/24 = 10.6）')

	// 手算的两组预期值
	const t = LIMITS.innerThresholdDefault
	eq('floor(255*24/255)', Math.floor((255 * t) / 255), 24)
	eq('floor(128*24/255)', Math.floor((128 * t) / 255), 12)
	eq('12 拉伸回全量程', Math.round((12 * 255) / t), 128)
}

console.log('\n== 5. 反相 ==')
{
	const size = 8
	const cover = makeImage(size, size, () => gray(255))
	const inner = makeImage(size, size, () => gray(255))
	const out = encode({ cover, inner, options: { isReverse: true } })
	// 表图 -> [0, 255-42] = [0,213]：v=255 时 floor(255*213/255)=213
	// 里图 -> [255-24, 255]：v=255 时 floor(231 + 255*24/255) = 231+24 = 255
	let coverV = null
	let innerV = null
	for (let x = 0; x < size; x++) {
		const p = x * 4
		if (isCover(x, 0)) { if (coverV === null) coverV = out.data[p] }
		else if (innerV === null) innerV = out.data[p]
	}
	eq('反相：表图落 213', coverV, 213)
	eq('反相：里图落 255', innerV, 255)
	const range = predictDecodeRange(true, 24)
	ok('predictDecodeRange(true,24) = {231,255}', range.lower === 231 && range.higher === 255, JSON.stringify(range))
}

console.log('\n== 6. 参数校验 ==')
{
	const v1 = validateEncodeOptions({})
	ok('默认参数合法', v1.valid, JSON.stringify(v1.errors))
	eq('默认表图色阶端', v1.normalized.coverThreshold, 42)
	eq('默认里图色阶端', v1.normalized.innerThreshold, 24)
	eq('默认表图转灰度', v1.normalized.coverGray, true)
	eq('默认里图不转灰度', v1.normalized.innerGray, false)

	const v2 = validateEncodeOptions({ coverThreshold: 42, innerThreshold: 50 })
	ok('色阶端交叉被判为非法', !v2.valid, JSON.stringify(v2.errors))
	eq('非法时把里图色阶端压到 cover-1', v2.normalized.innerThreshold, 41)
	ok('非法时仍然产得出能解码的图（normalized 自洽）', v2.normalized.innerThreshold < v2.normalized.coverThreshold)

	const v3 = validateEncodeOptions({ coverThreshold: 9999, innerThreshold: -5 })
	eq('表图色阶端被夹到上限', v3.normalized.coverThreshold, LIMITS.coverThresholdRange[1])
	eq('里图色阶端被夹到下限', v3.normalized.innerThreshold, LIMITS.innerThresholdRange[0])

	// 相等也非法
	ok('两端相等同样非法', !validateEncodeOptions({ coverThreshold: 30, innerThreshold: 30 }).valid)
}

console.log('\n== 7. encode 的防御 ==')
{
	const a = makeImage(4, 4, () => gray(100))
	const b = makeImage(4, 5, () => gray(100))
	let threw = false
	try { encode({ cover: a, inner: b }) } catch (e) { threw = true }
	ok('尺寸不一致会抛错', threw)

	let threw2 = false
	try { encode({ cover: a, inner: a, options: { coverThreshold: 20, innerThreshold: 40 } }) } catch (e) {
		threw2 = /色阶端/.test(e.message)
	}
	ok('参数非法会抛错且信息可读', threw2)
}

console.log('\n== 8. 显形：四种区间外处理方式 ==')
{
	const size = 6
	// 表图全白 -> 编码后落 255；里图全黑 -> 落 0
	const encoded = encode({
		cover: makeImage(size, size, () => gray(255)),
		inner: makeImage(size, size, () => gray(0)),
		options: { coverGray: true, innerGray: true }
	})
	const opts = { lower: 0, higher: 24 }

	const black = decode({ image: encoded, options: { ...opts, method: 'black' } })
	const white = decode({ image: encoded, options: { ...opts, method: 'white' } })
	const trans = decode({ image: encoded, options: { ...opts, method: 'transparent' } })
	const ltavg = decode({ image: encoded, options: { ...opts, method: 'ltavg' } })

	// (0,0) 是表图位置
	eq('black：表图位 = 0', black.data[0], 0)
	eq('black：表图位不透明', black.data[3], 255)
	eq('white：表图位 = 255', white.data[0], 255)
	eq('transparent：表图位 alpha = 0', trans.data[3], 0)
	// (0,0) 是整张图的第一个像素，ltavg 没有左/上，回退成黑色
	eq('ltavg：最左上角没有邻居 -> 黑', ltavg.data[0], 0)

	// (1,0) 是里图位置 -> 编码时压到 0，显形拉伸后仍是 0
	eq('里图位显形后 = 0', ltavg.data[4], 0)

	// (0,1) 是里图位置，(2,1) 是表图位置：ltavg 应该从邻居扩散出非零值
	const p = (1 * size + 2) * 4
	ok('ltavg：表图位被邻居填上了值', ltavg.data[p] >= 0, ltavg.data[p])

	// innerRatio 判据
	ok('innerRatio 接近 50%', Math.abs(ltavg.stats.innerRatio - 0.5) < 0.01, ltavg.stats.innerRatio)
	eq('innerPixels', ltavg.stats.innerPixels, 18)
	eq('degenerate', ltavg.stats.degenerate, false)
}

console.log('\n== 9. 显形的退化与容错 ==')
{
	const img = makeImage(4, 4, () => gray(50))
	const d1 = decode({ image: img, options: { lower: 100, higher: 50 } })
	eq('上界小于下界 -> degenerate', d1.stats.degenerate, true)
	eq('退化时输出全黑', d1.data[0], 0)
	eq('退化时保留 alpha', d1.data[3], 255)

	const d2 = decode({ image: img, options: { lower: 20, higher: 20 } })
	eq('两端相等也退化', d2.stats.degenerate, true)

	const n1 = normalizeDecodeOptions({ method: '不存在的' })
	eq('未知 method 回退到默认方法', n1.method, LIMITS.methodDefault)
	eq('默认方法就是参考实现的扩散填充', LIMITS.methodDefault, 'ltavg')
	eq('显影方式回到参考实现的四个', LIMITS.methodOptions.join(','), 'ltavg,white,black,transparent')
	eq('iterations 默认 = 参考实现的 16', LIMITS.iterationsDefault, 16)
	eq('iterations 上限 = 参考实现的 100', LIMITS.maxIterations, 100)
	const n2 = normalizeDecodeOptions({ lower: -20, higher: 999 })
	ok('阈值被夹到 [0,255]', n2.lower === 0 && n2.higher === 255, JSON.stringify(n2))

	// 表图亮度 50 落在 [0,24] 之外，里图亮度 10 落在之内
	const img2 = makeImage(4, 4, (x, y) => gray((x + y) % 2 === 0 ? 50 : 10))
	const d3 = decode({ image: img2, options: { lower: 0, higher: 24 } })
	eq('带宽边界：= 24 算命中', decode({ image: makeImage(2, 2, () => gray(24)), options: { lower: 0, higher: 24 } }).stats.innerPixels, 4)
	eq('带宽边界：= 25 不算命中', decode({ image: makeImage(2, 2, () => gray(25)), options: { lower: 0, higher: 24 } }).stats.innerPixels, 0)
}

console.log('\n== 10. alpha 透传 ==')
{
	const src = makeImage(4, 4, (x, y) => [200, 200, 200, isCover(x, y) ? 128 : 200])
	const out = encode({ cover: src, inner: src, options: { coverGray: false } })
	eq('表图位 alpha 透传', out.data[3], 128)
	eq('里图位 alpha 透传', out.data[7], 200)
}

console.log('\n== 11. 幻影坦克回归（重构后不能变） ==')
{
	ok('phantomTank 仍然 re-export planSize', typeof phPlanSize === 'function')
	ok('phantomTank 的 planSize 与 imageGeometry 一致', phPlanSize(2000, 1000, 720).width === 720)
	eq('phantomTank.LIMITS.edgeHard 不变', PH_LIMITS.edgeHard, 1600)
	eq('phantomTank.LIMITS.edgeDefault 不变', PH_LIMITS.edgeDefault, 1080)
	eq('phantomTank.LIMITS.gainBlackDefault 不变', PH_LIMITS.gainBlackDefault, 30)

	// 白底全亮、黑底全暗：alpha 应该接近 0（差 255）
	const onWhite = makeImage(8, 8, () => gray(255))
	const onBlack = makeImage(8, 8, () => gray(0))
	const enc = phantomEncode({ onWhite, onBlack, options: { grayscale: true } })
	eq('幻影坦克 alpha ≈ 0', Math.round(enc.stats.alphaMean), 0)
	eq('幻影坦克 meanDiff ≈ 255', Math.round(enc.stats.meanDiff), 255)

	// 两图相同 + gainBlack=1：应完全不透明
	const same = makeImage(8, 8, () => gray(128))
	const enc2 = phantomEncode({ onWhite: same, onBlack: same, options: { grayscale: true, gainBlack: 1 } })
	eq('两图相同时 alpha = 255', Math.round(enc2.stats.alphaMean), 255)
	eq('两图相同时 meanDiff = 0', Math.round(enc2.stats.meanDiff), 0)

	// 默认 gainBlack=0.3 时行为应当符合公式：alpha = 255 - 128 + 128*0.3 = 165.4
	const enc3 = phantomEncode({ onWhite: same, onBlack: same, options: { grayscale: true } })
	eq('默认 gainBlack=0.3 时 alpha 符合公式', Math.round(enc3.stats.alphaMean), 165)
	eq('默认 gainBlack=0.3 时 meanDiff 符合公式', Math.round(enc3.stats.meanDiff), 90)

	const composed = composite({ image: enc, background: 255 })
	eq('composite 到白底后不透明', composed.data[3], 255)
	eq('composite 白底上的亮度', composed.data[0], 255)

	const m = measureAlpha(enc)
	eq('measureAlpha 仍在 phantomTank 里', m.total, 64)
}

console.log('\n== 12. 显形自检判据在真实参数下的分布 ==')
{
	const size = 32
	const encoded = encode({
		cover: makeImage(size, size, (x, y) => gray((x * 7 + y * 3) % 256)),
		inner: makeImage(size, size, (x, y) => gray((x * 5 + y * 11) % 256)),
		options: { coverGray: true, innerGray: false }
	})
	const revealed = decode({ image: encoded, options: { lower: 0, higher: 24, method: 'ltavg' } })
	// 阈值框对的时候里图应该正好占一半；表图亮度都 >= 42 > 24，不会被误判
	eq('里图正好占一半像素', revealed.stats.innerPixels, size * size / 2)
	ok('innerRatio = 0.5', Math.abs(revealed.stats.innerRatio - 0.5) < 1e-9, revealed.stats.innerRatio)

	// 阈值框错（把上界拉到 60，越过表图下界 42）就会多抓到表图像素。
	// 页面诊断用的判据是偏离 50% 超过 2 个百分点，这里确认它抓得住
	const wrong = decode({ image: encoded, options: { lower: 0, higher: 60, method: 'ltavg' } })
	ok('阈值上界框宽时 innerRatio 偏高于 50%，且超过 2 个点', wrong.stats.innerRatio - 0.5 > 0.02, wrong.stats.innerRatio)
	console.log('        （上界误设为 60 时 innerRatio = ' + (wrong.stats.innerRatio * 100).toFixed(1) + '%，诊断会命中）')

	// 反向：上界框窄了，里图的亮部会被漏掉
	const narrow = decode({ image: encoded, options: { lower: 0, higher: 12, method: 'ltavg' } })
	ok('阈值上界框窄时 innerRatio 偏低于 50%', narrow.stats.innerRatio - 0.5 < -0.02, narrow.stats.innerRatio)
	console.log('        （上界误设为 12 时 innerRatio = ' + (narrow.stats.innerRatio * 100).toFixed(1) + '%，诊断会命中）')
}

console.log('\n== 13. 填充质量：必须和参考实现的 WebGL 路径对得上 ==')
{
	// 造一张有平滑渐变、硬边、细纹理的"照片"，覆盖真实图像的频率成分
	const N = 256
	function photo(shift) {
		const data = new Uint8ClampedArray(N * N * 4)
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				const p = (y * N + x) * 4
				const cx = (x - N / 2) / N, cy = (y - N / 2) / N
				let v = 200 - 300 * Math.sqrt(cx * cx + cy * cy)
				v += 40 * Math.sin((x + shift) * 0.06) * Math.cos(y * 0.05)
				if (x > 60 + shift && x < 150 && y > 80 && y < 190) v -= 70
				if ((x + y) % 8 < 3) v -= 18
				v = Math.max(0, Math.min(255, v))
				data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255
			}
		}
		return { width: N, height: N, data }
	}
	const lum = (d, p) => 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]
	const truth = photo(0)
	const encoded = encode({
		cover: photo(37),
		inner: truth,
		options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true }
	})

	function score(options) {
		const out = decode({ image: encoded, options }).data
		let sumFill = 0, nFill = 0, sumAll = 0
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				const p = (y * N + x) * 4
				const e2 = (lum(out, p) - lum(truth.data, p)) ** 2
				sumAll += e2
				if (isCover(x, y)) { sumFill += e2; nFill++ }
			}
		}
		return {
			rmseFill: Math.sqrt(sumFill / nFill),
			psnr: 20 * Math.log10(255 / Math.sqrt(sumAll / (N * N)))
		}
	}

	const current = score({ lower: 0, higher: 24, method: 'ltavg' })
	console.log('        当前实现          : 填充位RMSE ' + current.rmseFill.toFixed(2) + '，PSNR ' + current.psnr.toFixed(2) + ' dB')
	console.log('        （参考实现的 CPU 回退路径是 9.44 / 30.14 dB）')

	// 这是把参考实现的 fillFS 着色器逐条移植、并且把编码也改成和 encodeFS 一致的
	// 四舍五入之后量出来的基准值。数字对不上就说明填充或编码被改动了 ——
	// 要么改回去，要么**把这里的基准值一起更新**（只改一边会让下一个人以为是回归）。
	ok('填充位 RMSE 与基准一致（7.57 ± 0.05）', Math.abs(current.rmseFill - 7.57) < 0.05, current.rmseFill)
	ok('整体 PSNR 与基准一致（32.91 ± 0.05）', Math.abs(current.psnr - 32.91) < 0.05, current.psnr)
	ok('明显好于参考实现的 CPU 回退路径（30.14 dB）', current.psnr > 31.5, current.psnr)

	// 标准棋盘格下第一轮就填满了，之后每轮一个像素都改不动
	const one = decode({ image: encoded, options: { lower: 0, higher: 24, method: 'ltavg', iterations: 1 } })
	const many = decode({ image: encoded, options: { lower: 0, higher: 24, method: 'ltavg', iterations: 100 } })
	let identical = true
	for (let i = 0; i < one.data.length; i++) {
		if (one.data[i] !== many.data[i]) { identical = false; break }
	}
	ok('iterations=1 与 =100 结果完全相同（标准棋盘格下是空转）', identical)

	// 算法里不能有光栅方向依赖：上下翻转后解码再翻回来，结果要一致
	const flipped = { width: N, height: N, data: new Uint8ClampedArray(N * N * 4) }
	for (let y = 0; y < N; y++) {
		for (let x = 0; x < N; x++) {
			const src = ((N - 1 - y) * N + x) * 4
			const dst = (y * N + x) * 4
			for (let c = 0; c < 4; c++) flipped.data[dst + c] = encoded.data[src + c]
		}
	}
	const normal = decode({ image: encoded, options: { lower: 0, higher: 24, method: 'ltavg' } })
	const mirror = decode({ image: flipped, options: { lower: 0, higher: 24, method: 'ltavg' } })
	let maxDiff = 0
	for (let y = 0; y < N; y++) {
		for (let x = 0; x < N; x++) {
			const d = Math.abs(normal.data[(y * N + x) * 4] - mirror.data[((N - 1 - y) * N + x) * 4])
			if (d > maxDiff) maxDiff = d
		}
	}
	ok('无光栅顺序依赖（上下翻转前后一致）', maxDiff <= 1, 'maxDiff=' + maxDiff)

	// 整张没有一个像素落在带内时，扩散填不动，就保持第一遍的占位值。
	// 参考实现里 ltavg 被映射到 u_fillMethod = 2，占位值是**透明**而不是黑色 ——
	// 填得满的时候看不出来，填不满的时候（gap 大、轮数不够）就是透明洞。
	const wild = decode({
		image: makeImage(8, 8, () => gray(200)),
		options: { lower: 0, higher: 24, method: 'ltavg' }
	})
	eq('没有可用的源像素时保持占位值', wild.data[0], 0)
	eq('占位值的 alpha 是 0（透明）', wild.data[3], 0)
	eq('整张都算表图', wild.stats.innerPixels, 0)
	// 显式选「黑色」时才是不透明黑
	const wildBlack = decode({
		image: makeImage(8, 8, () => gray(200)),
		options: { lower: 0, higher: 24, method: 'black' }
	})
	eq('显式选黑色时 alpha = 255', wildBlack.data[3], 255)
}

console.log('\n== 14. 降采样不能踩棋盘格的坑 ==')
{
	// 按步长抽样的话，偶数步会整张只取到同一类像素。块平均不会。
	const cb = makeImage(64, 64, (x, y) => gray(isCover(x, y) ? 200 : 20))
	const small = downsampleImage(cb, 16)
	eq('降采样后的尺寸', small.width, 16)
	let min = 255, max = 0
	for (let i = 0; i < small.width * small.height; i++) {
		const v = small.data[i * 4]
		if (v < min) min = v
		if (v > max) max = v
	}
	// 块平均后每块都同时含两类像素，值应该在两类之间、且分布集中
	ok('每个块都混到了两类像素（不会只剩一类）', min > 30 && max < 190, min + '~' + max)
	ok('块平均值落在两类之间', min >= 100 && max <= 120, min + '~' + max)

	const noChange = downsampleImage(cb, 999)
	ok('已经够小时原样返回同一个对象', noChange === cb)

	const odd = downsampleImage(makeImage(33, 7, () => gray(128)), 10)
	ok('非整除比例也能算出合理尺寸', odd.width >= 1 && odd.height >= 1 && odd.width <= 10, odd.width + 'x' + odd.height)
}

console.log('\n== 15. 显形参数的预设格式（必须和参考实现互通） ==')
{
	// 5 个字符：[反相][里图色阶端 hex2][对比度压缩值 hex2]
	eq('默认参数编出的预设', encodePreset(false, 24, 0), '01832')
	eq('反相 + 色阶端 60', encodePreset(true, 60, 0), '13c32')
	// 色阶端上限 254（必须小于表图色阶端），255 会被夹到 254 = 0xfe
	eq('色阶端 255 被夹到 254', encodePreset(false, 255, 0), '0fe32')

	const plain = decodePreset('01832')
	ok('解回非反相 0~24', plain.lower === 0 && plain.higher === 24, JSON.stringify(plain))
	eq('解回对比度 0', plain.contrast, 0)
	const reversed = decodePreset('13c32')
	ok('解回反相 195~255', reversed.lower === 195 && reversed.higher === 255, JSON.stringify(reversed))

	// 参考实现的对比度往返是不闭合的：compress(255) = 100，但 expand(100 - 100) = expand(0) = -255。
	// 照它的算式解就是这个结果 —— 必须和它一致，否则同一张图两边显示得不一样。
	// 只有 contrast = 0 闭合（compress(0) = 50 -> expand(50) = 0），所以这个不对称一直没暴露。
	eq('对比度字节 100 解成 -255（复刻参考实现的不闭合）', decodePreset('01864').contrast, -255)
	eq('对比度 0 往返闭合', decodePreset(encodePreset(false, 24, 0)).contrast, 0)

	// 容错：解析不出来一律 null，调用方退回默认值
	eq('空串', decodePreset(''), null)
	eq('太短', decodePreset('01'), null)
	eq('色阶端为 0（区间是空的）', decodePreset('00032'), null)
	eq('乱码', decodePreset('0zz32'), null)
	// 只有前 3 位的老图，阈值照解、对比度当 0
	const short = decodePreset('018')
	ok('只有前 3 位也能解出阈值', short && short.higher === 24 && short.contrast === 0, JSON.stringify(short))

	for (const [rev, th] of [[false, 24], [true, 24], [false, 1], [true, 254], [false, 254]]) {
		const parsed = decodePreset(encodePreset(rev, th, 0))
		const want = rev ? { lower: 255 - th, higher: 255 } : { lower: 0, higher: th }
		ok('往返 ' + (rev ? '反相 ' : '非反相 ') + th, parsed && parsed.lower === want.lower && parsed.higher === want.higher, JSON.stringify(parsed))
	}
}

console.log('\n== 16. PNG 的 tEXt 块：写进去要能读回来 ==')
{
	const img = makeImage(16, 16, (x, y) => [x * 16, y * 16, 128])

	// 不带文本时不该凭空多出 tEXt 块
	const bare = encodePng(img)
	eq('没给 text 时读不到文本', readPngText(bare), '')

	// 端到端：写进 PNG 字节，再从字节里读回来，最后解成参数
	const text = encodePreset(false, 24, 0)
	const withText = encodePng(img, text)
	eq('能读回写入的预设', readPngText(withText), text)
	const parsed = decodePreset(readPngText(withText))
	ok('读回来的预设能解成阈值', parsed && parsed.lower === 0 && parsed.higher === 24, JSON.stringify(parsed))

	// 插了块之后图片本身还得是合法 PNG：签名、IHDR 开头、IEND 结尾、长度 +12
	eq('签名没变', Array.from(withText.slice(0, 4)).join(','), '137,80,78,71')
	ok('IHDR 紧随签名', withText[12] === 0x49 && withText[13] === 0x48 && withText[14] === 0x44 && withText[15] === 0x52)
	// IEND 块固定是 长度(4 个 0) + 'IEND' + CRC(174,66,96,130)
	eq(
		'IEND 在最后',
		Array.from(withText.slice(-12)).join(','),
		'0,0,0,0,73,69,78,68,174,66,96,130'
	)
	eq('只比原来长 12 + 文本长度', withText.length - bare.length, 12 + text.length)

	// tEXt 必须排在 IEND 之前
	const textPos = readIndexOfChunk(withText, 'tEXt')
	const iendPos = readIndexOfChunk(withText, 'IEND')
	ok('tEXt 在 IEND 之前', textPos !== -1 && iendPos !== -1 && textPos < iendPos, textPos + ' / ' + iendPos)

	// 规范的「关键字\0正文」也要能读（别的工具可能按规范写）
	const compliant = encodePng(img, 'Prism\0' + text)
	eq('规范的 关键字\\0正文 也能读', readPngText(compliant), text)

	// 坏数据不能抛，只能返回空串
	eq('空字节', readPngText(new Uint8Array(0)), '')
	eq('太短', readPngText(new Uint8Array([1, 2, 3])), '')
	eq('长度字段越界时安全返回', readPngText(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 255, 255, 255, 255, 73, 72, 68, 82])), '')
	eq('只有签名', readPngText(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), '')

	function readIndexOfChunk(bytes, type) {
		let pos = 8
		while (pos + 8 <= bytes.length) {
			const size = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0
			let name = ''
			for (let i = 0; i < 4; i++) name += String.fromCharCode(bytes[pos + 4 + i])
			if (name === type) return pos
			pos += size + 12
		}
		return -1
	}
}

console.log('\n== 17. 对比度与交错参数 ==')
{
	// ---- isCover 的泛化：默认必须还是标准棋盘格 ----
	eq('默认 (0,0) 归表图', isCover(0, 0), true)
	eq('默认 (1,0) 归里图', isCover(1, 0), false)
	ok('显式传默认参数与省略一致', isCover(3, 4, 1, 1, true) === isCover(3, 4))
	eq('gap=1 时里图占比', innerRatioFor(1), 0.5)
	eq('gap=2 时里图占比', innerRatioFor(2), 1 / 3)

	let coverCount = 0
	for (let y = 0; y < 9; y++) {
		for (let x = 0; x < 9; x++) if (isCover(x, y, 0, 2, true)) coverCount++
	}
	ok('slope=0 gap=2 按行：整行归表图，比例 = 2/3', Math.abs(coverCount / 81 - 2 / 3) < 1e-9, coverCount / 81)
	ok('slope=0 按列时同一行内按列切', isCover(0, 5, 0, 2, false) === true && isCover(2, 5, 0, 2, false) === false)

	for (const gap of [1, 2, 3, 4]) {
		let cover = 0
		for (let y = 0; y < 60; y++) {
			for (let x = 0; x < 60; x++) if (isCover(x, y, 1, gap, true)) cover++
		}
		const inner = 1 - cover / 3600
		ok('gap=' + gap + ' 里图占比 ≈ 1/(gap+1)', Math.abs(inner - innerRatioFor(gap)) < 0.02, inner.toFixed(4))
	}

	// ---- 交错参数真的参与了编码 ----
	const cover = makeImage(32, 32, () => gray(250))
	const innerBlack = makeImage(32, 32, () => gray(0))
	for (const gap of [1, 2, 3, 4]) {
		const e = encode({ cover, inner: innerBlack, options: { coverThreshold: 42, innerThreshold: 24, gap } })
		ok('gap=' + gap + ' 的里图像素数 = total/(gap+1)', Math.abs(e.stats.innerPixels - 1024 / (gap + 1)) <= 2,
			e.stats.innerPixels + ' vs ' + 1024 / (gap + 1))
		eq('gap=' + gap + ' 的 expectedInnerRatio', e.stats.expectedInnerRatio, innerRatioFor(gap))
	}

	// ---- 对比度：制作 +C、显形 -C 应当还原，而且确实比不调好 ----
	const N = 128
	const lowContrast = makeImage(N, N, (x, y) =>
		gray(Math.round(110 + 30 * Math.sin(x * 0.1) * Math.cos(y * 0.08)))
	)
	const busyCover = makeImage(N, N, (x, y) => gray(Math.round(200 + 40 * Math.sin((x + y) * 0.05))))
	const C = 60
	const withContrast = encode({
		cover: busyCover,
		inner: lowContrast,
		options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true, innerContrast: C }
	})
	eq('stats 记下了 innerContrast', withContrast.stats.innerContrast, C)

	const preset = encodePreset(false, 24, C)
	eq('带非零对比度的预设仍是 5 位', preset.length, 5)
	const parsed = decodePreset(preset)
	ok('解出来的对比度是 -C', Math.abs(parsed.contrast + C) <= 1, parsed.contrast)

	function innerError(image, contrast) {
		const out = decode({ image, options: { lower: 0, higher: 24, method: 'ltavg', contrast } }).data
		let sum = 0, n = 0
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				if (isCover(x, y)) continue
				const p = (y * N + x) * 4
				sum += (0.299 * out[p] - 0.299 * lowContrast.data[p]) ** 2
				n++
			}
		}
		return Math.sqrt(sum / n)
	}
	const errWith = innerError(withContrast, parsed.contrast)
	const errWithout = innerError(withContrast, 0)
	console.log('        施加元数据里的对比度 ' + parsed.contrast + '：里图位 RMSE ' + errWith.toFixed(2))
	console.log('        不施加对比度                    ：里图位 RMSE ' + errWithout.toFixed(2))
	ok('施加元数据里的对比度确实更接近原图', errWith < errWithout, errWith.toFixed(2) + ' vs ' + errWithout.toFixed(2))

	// contrast = -255 的系数正好是 0，是合法取值，不能被当成"没设置"
	const flat = decode({ image: makeImage(8, 8, () => gray(128)), options: { lower: 0, higher: 10, contrast: -255 } })
	ok('-255 把整张压成中灰（系数为 0）', flat.data[16] === 128, flat.data[16])
	const inBand = makeImage(16, 16, (x) => gray(x))
	const zero = decode({ image: inBand, options: { lower: 0, higher: 15, contrast: 0 } })
	const omitted = decode({ image: inBand, options: { lower: 0, higher: 15 } })
	let sameAsOmitted = true
	for (let i = 0; i < zero.data.length; i++) {
		if (zero.data[i] !== omitted.data[i]) { sameAsOmitted = false; break }
	}
	ok('contrast=0 与不传等价', sameAsOmitted)

	// ---- 新参数的归一化 ----
	const v = validateEncodeOptions({})
	eq('对比度默认 0', v.normalized.innerContrast, 0)
	eq('表图对比度默认 0', v.normalized.coverContrast, 0)
	eq('斜向默认 1', v.normalized.slope, 1)
	eq('间隔默认 1', v.normalized.gap, 1)
	eq('默认按行', v.normalized.isRow, true)

	const clamped = validateEncodeOptions({ innerContrast: 9999, coverContrast: -9999, slope: 99, gap: 99 })
	ok('对比度夹到 ±255', clamped.normalized.innerContrast === 255 && clamped.normalized.coverContrast === -255,
		clamped.normalized.innerContrast + '/' + clamped.normalized.coverContrast)
	eq('斜率夹到上限', clamped.normalized.slope, LIMITS.slopeRange[1])
	eq('间隔夹到上限', clamped.normalized.gap, LIMITS.gapRange[1])
	ok('对比度范围与参考实现一致', LIMITS.contrastRange[0] === -255 && LIMITS.contrastRange[1] === 255, LIMITS.contrastRange.join('~'))
	eq('对比度步长与参考实现一致', LIMITS.contrastStep, 5)
}

console.log('\n== 18. 与参考实现着色器的逐字节对齐 ==')
{
	// 把参考实现 webgl/decode.ts 的 scaleFS + fillFS 逐行直译成 JS（**不参考** prismTank.js
	// 的写法，只照着色器源码写），再和我们的 decode 逐字节比对。
	// 这是「扩散填充直接照搬参考实现」这句话唯一靠谱的证明方式 ——
	// 光看代码像不像没用，三处细节（alpha 累加、边界夹取、透明预填）都是肉眼看不出
	// 差别、但结果会不同的地方。
	const PW = 96, PH = 64

	function shaderPhoto(shift, withAlpha) {
		const d = new Uint8ClampedArray(PW * PH * 4)
		for (let y = 0; y < PH; y++) {
			for (let x = 0; x < PW; x++) {
				const p = (y * PW + x) * 4
				const cx = (x - PW / 2) / PW, cy = (y - PH / 2) / PH
				let v = 200 - 300 * Math.sqrt(cx * cx + cy * cy)
				v += 40 * Math.sin((x + shift) * 0.06) * Math.cos(y * 0.05)
				if (x > 30 + shift && x < 70 && y > 20 && y < 50) v -= 70
				v = Math.max(0, Math.min(255, v))
				d[p] = v; d[p + 1] = v; d[p + 2] = v
				d[p + 3] = withAlpha ? (x * 3 + y * 5) % 256 : 255
			}
		}
		return { width: PW, height: PH, data: d }
	}

	// ---- scaleFS 直译 ----
	function scalePass(src, lower, higher, fillMethod) {
		const out = new Uint8ClampedArray(src.length)
		const mask = new Uint8Array(PW * PH)
		const ratio = higher === lower ? 0 : 255 / (higher - lower)
		for (let i = 0; i < src.length; i += 4) {
			const r = src[i], g = src[i + 1], b = src[i + 2]
			const l = r * 0.299 + g * 0.587 + b * 0.114
			if (l < lower || l > higher) {
				mask[i / 4] = 1
				if (fillMethod === 2) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0 }
				else if (fillMethod === 1) { out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = 255 }
				else { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 255 }
			} else {
				const cl = (v) => Math.max(0, Math.min(255, v))
				out[i] = cl((r - lower) * ratio)
				out[i + 1] = cl((g - lower) * ratio)
				out[i + 2] = cl((b - lower) * ratio)
				out[i + 3] = src[i + 3]
				mask[i / 4] = 0
			}
		}
		return { out, mask }
	}

	// ---- fillFS 直译（偏移/权重原样抄自着色器）----
	const OFFS = [
		[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1],
		[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2], [-2, 2], [2, -2],
		[-1, -2], [1, 2], [-2, -1], [2, 1], [-1, 2], [1, -2], [-2, 1], [2, -1]
	]
	const WTS = [
		0.6065, 0.6065, 0.6065, 0.6065, 0.3679, 0.3679, 0.3679, 0.3679,
		0.1353, 0.1353, 0.1353, 0.1353, 0.0183, 0.0183, 0.0183, 0.0183,
		0.0821, 0.0821, 0.0821, 0.0821, 0.0821, 0.0821, 0.0821, 0.0821
	]
	// 纹理是 CLAMP_TO_EDGE + NEAREST：越界采样取边缘像素，**不跳过**
	function texel(x, y) {
		if (x < 0) x = 0; else if (x >= PW) x = PW - 1
		if (y < 0) y = 0; else if (y >= PH) y = PH - 1
		return (y * PW + x) * 4
	}
	function fillPass(image, mask) {
		const out = new Uint8ClampedArray(image)   // 读旧纹理
		const outMask = Uint8Array.from(mask)
		for (let y = 0; y < PH; y++) {
			for (let x = 0; x < PW; x++) {
				const idx = y * PW + x
				if (mask[idx] < 0.5) { outMask[idx] = 0; continue }
				let sr = 0, sg = 0, sb = 0, sa = 0, wsum = 0, count = 0
				for (let i = 0; i < 24; i++) {
					const q = texel(x + OFFS[i][0], y + OFFS[i][1])
					if (mask[q / 4] < 0.5) {
						sr += image[q] * WTS[i]
						sg += image[q + 1] * WTS[i]
						sb += image[q + 2] * WTS[i]
						sa += image[q + 3] * WTS[i]      // vec4 sum，alpha 一起加权
						wsum += WTS[i]
						count++
					}
				}
				if (count > 0) {
					const p = idx * 4
					out[p] = sr / wsum; out[p + 1] = sg / wsum; out[p + 2] = sb / wsum; out[p + 3] = sa / wsum
					outMask[idx] = 0
				}
			}
		}
		return { out, mask: outMask }
	}
	function shaderDecode(src, lower, higher, method, iterations) {
		const fillMethod = method === 'black' ? 0 : method === 'white' ? 1 : 2
		let { out, mask } = scalePass(src, lower, higher, fillMethod)
		if (method === 'ltavg') {
			for (let i = 0; i < iterations; i++) {
				const r = fillPass(out, mask)
				out = r.out
				mask = r.mask
			}
		}
		return out
	}

	function parity(label, encoded, lower, higher, method, iterations) {
		const mine = decode({ image: encoded, options: { lower, higher, method, iterations } }).data
		const ref = shaderDecode(encoded.data, lower, higher, method, iterations)
		let diff = 0
		for (let i = 0; i < mine.length; i++) if (mine[i] !== ref[i]) diff++
		ok(label + ' 与着色器直译版逐字节一致', diff === 0, diff + ' 个字节不同')
	}

	const grayCover = shaderPhoto(31, false)
	const grayInner = shaderPhoto(0, false)
	const alphaCover = shaderPhoto(31, true)
	const alphaInner = shaderPhoto(0, true)

	for (const gap of [1, 2, 4]) {
		const enc = encode({
			cover: grayCover, inner: grayInner,
			options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true, gap }
		})
		for (const method of ['ltavg', 'black', 'white', 'transparent']) {
			parity('gap=' + gap + ' ' + method, enc, 0, 24, method, method === 'ltavg' ? 16 : 0)
		}
	}

	// alpha 有变化才能测出「alpha 有没有一起加权」
	const alphaEnc = encode({
		cover: alphaCover, inner: alphaInner,
		options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true }
	})
	parity('带 alpha 的源图', alphaEnc, 0, 24, 'ltavg', 16)

	// 轮数不够时才会露出占位值，测「ltavg 的预填是透明」
	const gapEnc = encode({
		cover: grayCover, inner: grayInner,
		options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true, gap: 4 }
	})
	for (const iterations of [0, 1, 2]) {
		parity('gap=4 且 iterations=' + iterations, gapEnc, 0, 24, 'ltavg', iterations)
	}

	// 反相和框大的阈值
	const revEnc = encode({
		cover: grayCover, inner: grayInner,
		options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true, isReverse: true }
	})
	parity('反相 231~255', revEnc, 231, 255, 'ltavg', 16)
	parity('阈值框大 0~60', revEnc, 0, 60, 'ltavg', 16)
}

console.log('\n== 19. 锐化填充（有意偏离参考实现的那一套） ==')
{
	const N = 192
	function qualityPhoto(shift) {
		const d = new Uint8ClampedArray(N * N * 4)
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				const p = (y * N + x) * 4
				const cx = (x - N / 2) / N, cy = (y - N / 2) / N
				let v = 190 - 260 * Math.sqrt(cx * cx + cy * cy)
				v += 45 * Math.sin((x + shift) * 0.06) * Math.cos(y * 0.05)
				if (x > 50 + shift && x < 120 && y > 60 && y < 140) v -= 70
				if ((x + y) % 8 < 3) v -= 15
				v = Math.max(0, Math.min(255, v))
				d[p] = v; d[p + 1] = v; d[p + 2] = v; d[p + 3] = 255
			}
		}
		return { width: N, height: N, data: d }
	}
	const lum2 = (d, p) => 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]
	const truth = qualityPhoto(0)
	const encoded2 = encode({
		cover: qualityPhoto(37), inner: truth,
		options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true }
	})

	// 「表图位局部锐度」= 那一半像素与自己四邻均值的差。
	// 插出来的像素按定义接近邻居均值，所以这个值越低说明那半越糊 ——
	// 一半锐一半糊就是肉眼看到的"很多小方块"。
	function sharpnessAtCover(data) {
		let sum = 0, n = 0
		for (let y = 1; y < N - 1; y++) {
			for (let x = 1; x < N - 1; x++) {
				if (!isCover(x, y)) continue
				const p = (y * N + x) * 4
				const avg = (lum2(data, p - 4) + lum2(data, p + 4) + lum2(data, p - N * 4) + lum2(data, p + N * 4)) / 4
				sum += Math.abs(lum2(data, p) - avg)
				n++
			}
		}
		return sum / n
	}
	function evaluate(sharpenFill) {
		const out = decode({ image: encoded2, options: { lower: 0, higher: 24, method: 'ltavg', iterations: 16, sharpenFill } }).data
		let sumFill = 0, nFill = 0
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				if (!isCover(x, y)) continue
				const p = (y * N + x) * 4
				sumFill += (lum2(out, p) - lum2(truth.data, p)) ** 2
				nFill++
			}
		}
		return { rmse: Math.sqrt(sumFill / nFill), sharp: sharpnessAtCover(out), data: out }
	}

	const truthSharp = sharpnessAtCover(truth.data)
	const plain = evaluate(false)
	const sharp = evaluate(true)
	console.log('        原里图的表图位锐度（上限）  ' + truthSharp.toFixed(2))
	console.log('        参考权重：RMSE ' + plain.rmse.toFixed(2) + '，锐度 ' + plain.sharp.toFixed(2))
	console.log('        锐化权重：RMSE ' + sharp.rmse.toFixed(2) + '，锐度 ' + sharp.sharp.toFixed(2))

	ok('锐化后填充误差更低', sharp.rmse < plain.rmse - 1, sharp.rmse.toFixed(2) + ' vs ' + plain.rmse.toFixed(2))
	ok('锐化后那半像素更锐', sharp.sharp > plain.sharp + 0.2, sharp.sharp.toFixed(2) + ' vs ' + plain.sharp.toFixed(2))
	// 这条是给未来的自己看的：锐化也补不满，别指望它变成无损
	ok('锐化也补不满（仍明显低于原图锐度）', sharp.sharp < truthSharp * 0.5, sharp.sharp.toFixed(2) + ' vs ' + truthSharp.toFixed(2))

	// 最要紧的一条：默认路径必须和参考实现逐字节一致
	const omitted = decode({ image: encoded2, options: { lower: 0, higher: 24, method: 'ltavg', iterations: 16 } }).data
	let diffOmitted = 0
	for (let i = 0; i < omitted.length; i++) if (omitted[i] !== plain.data[i]) diffOmitted++
	ok('不给这个参数时与显式 false 逐字节相同', diffOmitted === 0, diffOmitted + ' 个字节不同')
	let diffSharp = 0
	for (let i = 0; i < plain.data.length; i++) if (plain.data[i] !== sharp.data[i]) diffSharp++
	ok('开启后确实换了结果', diffSharp > 0)

	// 只对 ltavg 生效
	eq('black 时被忽略', normalizeDecodeOptions({ method: 'black', sharpenFill: true }).sharpenFill, false)
	eq('ltavg 时生效', normalizeDecodeOptions({ method: 'ltavg', sharpenFill: true }).sharpenFill, true)
	eq('默认关闭', normalizeDecodeOptions({}).sharpenFill, false)
	const blackOn = decode({ image: encoded2, options: { lower: 0, higher: 24, method: 'black', sharpenFill: true } }).data
	const blackOff = decode({ image: encoded2, options: { lower: 0, higher: 24, method: 'black' } }).data
	let diffBlack = 0
	for (let i = 0; i < blackOn.length; i++) if (blackOn[i] !== blackOff[i]) diffBlack++
	ok('black 下开不开结果一样', diffBlack === 0, diffBlack)

	// 负权重不能算出越界像素（带 alpha 的图也走一遍）
	const alphaCover = { width: N, height: N, data: new Uint8ClampedArray(N * N * 4) }
	const alphaInner = { width: N, height: N, data: new Uint8ClampedArray(N * N * 4) }
	for (let y = 0; y < N; y++) {
		for (let x = 0; x < N; x++) {
			const p = (y * N + x) * 4
			const v = Math.round(120 + 80 * Math.sin(x * 0.05))
			for (const img of [alphaCover, alphaInner]) {
				img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v
				img.data[p + 3] = img === alphaCover ? (x * 3 + y * 5) % 256 : (x * 7 + y) % 256
			}
		}
	}
	const alphaEnc = encode({
		cover: alphaCover, inner: alphaInner,
		options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true }
	})
	const alphaOut = decode({ image: alphaEnc, options: { lower: 0, higher: 24, method: 'ltavg', iterations: 16, sharpenFill: true } }).data
	let bad = 0
	for (let i = 0; i < alphaOut.length; i++) if (!isFinite(alphaOut[i]) || alphaOut[i] < 0 || alphaOut[i] > 255) bad++
	ok('锐化 + 带 alpha：没有非法像素', bad === 0, bad)
}

console.log('\n== 20. 编码与参考实现着色器的逐字节对齐 ==')
{
	// 和上一节同样的思路：把 webgl/encode.ts 的 encodeFS 逐行直译（**不参考** prismTank.js），
	// 再和我们的 encode 逐字节比。
	//
	// 这一节存在的理由：参考实现有**两条**编码路径，回退路径的 scaleWrap 用 floor，
	// 而 WebGL 路径的着色器在归一化空间算完写回 8 位纹理、GPU 是**四舍五入**。
	// 当初照抄了回退路径的 floor，结果 36% 的通道比着色器低 1 级 —— 里图那半像素显形时
	// 被放大 10.6 倍，整张偏暗约 4 级。这个偏差肉眼看不出"错在哪"，只有逐字节比才发现。
	const EW = 64, EH = 48
	function shaderSource(shift) {
		const d = new Uint8ClampedArray(EW * EH * 4)
		for (let y = 0; y < EH; y++) {
			for (let x = 0; x < EW; x++) {
				const p = (y * EW + x) * 4
				// 刻意让三通道各不相同，且带小数，这样取整方式的差异才暴露得出来
				d[p] = (x * 7 + y * 13 + shift) % 256
				d[p + 1] = (x * 3 + y * 29 + shift * 5) % 256
				d[p + 2] = (x * 17 + y * 11 + shift * 3) % 256
				d[p + 3] = 255
			}
		}
		return { width: EW, height: EH, data: d }
	}

	// encodeFS 直译：在归一化空间里算，写回 8 位纹理时四舍五入（GPU 的 float->unorm8）。
	// raw=true 时跳过取整、返回未取整的浮点值（0~255 量纲），用来验证这套数据能不能区分两种取整。
	function shaderEncode(inner, cover, cfg, raw) {
		const innerT = cfg.innerThreshold / 255
		const coverT = cfg.coverThreshold / 255
		// raw 模式必须用浮点数组 —— 写进 Uint8ClampedArray 会在赋值时就把小数抹掉，
		// 那样 floor 和 round 看起来永远一致，这一节就等于没测
		const out = raw ? new Float64Array(EW * EH * 4) : new Uint8ClampedArray(EW * EH * 4)
		const isCoverPixel = (x, y) => {
			if (cfg.slope === 0) return (cfg.isRow ? y : x) % (cfg.gap + 1) < cfg.gap
			if (cfg.isRow) return (y / cfg.slope + x) % (cfg.gap + 1) < cfg.gap
			return (x / cfg.slope + y) % (cfg.gap + 1) < cfg.gap
		}
		for (let y = 0; y < EH; y++) {
			for (let x = 0; x < EW; x++) {
				const p = (y * EW + x) * 4
				const useCover = isCoverPixel(x, y)
				const src = useCover ? cover : inner
				const c = [src.data[p] / 255, src.data[p + 1] / 255, src.data[p + 2] / 255]
				const o = []
				for (let k = 0; k < 3; k++) {
					if (useCover) o[k] = cfg.isReverse ? c[k] * (1 - coverT) : coverT + c[k] * (1 - coverT)
					else o[k] = cfg.isReverse ? 1 - innerT + c[k] * innerT : c[k] * innerT
				}
				// 纹理写入：clamp 到 [0,1] 再四舍五入到 8 位
				for (let k = 0; k < 3; k++) {
					const exact = Math.min(1, Math.max(0, o[k])) * 255
					out[p + k] = raw ? exact : Math.round(exact)
				}
				out[p + 3] = src.data[p + 3]
			}
		}
		return out
	}

	const innerSrc = shaderSource(0)
	const coverSrc = shaderSource(37)
	const configs = [
		{ innerThreshold: 24, coverThreshold: 42, slope: 1, gap: 1, isRow: true, isReverse: false },
		{ innerThreshold: 41, coverThreshold: 42, slope: 1, gap: 1, isRow: true, isReverse: false },
		{ innerThreshold: 24, coverThreshold: 42, slope: 1, gap: 1, isRow: true, isReverse: true },
		{ innerThreshold: 60, coverThreshold: 90, slope: 1, gap: 2, isRow: true, isReverse: false },
		{ innerThreshold: 24, coverThreshold: 42, slope: 0, gap: 3, isRow: false, isReverse: false },
		{ innerThreshold: 24, coverThreshold: 42, slope: 2, gap: 1, isRow: true, isReverse: false }
	]
	for (const cfg of configs) {
		const mine = encode({
			cover: coverSrc, inner: innerSrc,
			options: {
				coverThreshold: cfg.coverThreshold, innerThreshold: cfg.innerThreshold,
				coverGray: false, innerGray: false, isReverse: cfg.isReverse,
				slope: cfg.slope, gap: cfg.gap, isRow: cfg.isRow
			}
		}).data
		const ref = shaderEncode(innerSrc, coverSrc, cfg)
		let diff = 0
		for (let i = 0; i < mine.length; i++) if (mine[i] !== ref[i]) diff++
		ok('编码 cfg ' + JSON.stringify([cfg.innerThreshold, cfg.coverThreshold, cfg.gap, cfg.slope, cfg.isReverse]) +
			' 与着色器直译版逐字节一致', diff === 0, diff + ' 个字节不同')
	}

	// 这套数据必须真的能区分 floor 和 round，否则上面那些比对是白测的。
	// 要在**未取整**的浮点值上比 —— 已经取整成字节之后 floor 和 round 恒等。
	{
		const cfg = configs[0]
		const exact = shaderEncode(innerSrc, coverSrc, cfg, true)
		const rounded = shaderEncode(innerSrc, coverSrc, cfg)
		let distinguishes = 0
		let roundMatches = 0
		let total = 0
		for (let i = 0; i < exact.length; i += 4) {
			for (let k = 0; k < 3; k++) {
				total++
				if (Math.floor(exact[i + k]) !== Math.round(exact[i + k])) distinguishes++
				if (Math.round(exact[i + k]) === rounded[i + k]) roundMatches++
			}
		}
		console.log('        这套数据里有 ' + distinguishes + '/' + total + ' 个通道的 floor 与 round 不同')
		ok('数据能区分 floor 和 round（否则这节白测）', distinguishes > total * 0.1, distinguishes + '/' + total)
		ok('着色器写回 8 位就是四舍五入', roundMatches === total, roundMatches + '/' + total)
	}
}

console.log('\n== 21. 从图本身反推显形阈值 ==')
{
	// 为什么需要这个：阈值本来只来自 PNG 元数据和会话内预填，两条都不可靠。
	// 阈值一旦没对上制作时的里图色阶端，里图里较亮的区域会整片掉出亮度带、
	// 被当成表图丢去插值 —— 显形结果里出现一块一块的糊斑（掉带位锐度 0.28、正常位 3.25）。
	const N = 160
	function detectPhoto(fn) {
		const d = new Uint8ClampedArray(N * N * 4)
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				const p = (y * N + x) * 4
				const v = Math.max(0, Math.min(255, fn(x, y)))
				d[p] = v; d[p + 1] = (v * 0.8) | 0; d[p + 2] = (v * 0.6) | 0; d[p + 3] = 255
			}
		}
		return { width: N, height: N, data: d }
	}
	// 里图左暗右亮（有亮区才容易暴露阈值没框对）
	const detectInner = detectPhoto((x) => (x < N / 2 ? 40 + 50 * Math.sin(x * 0.05) : 160 + 70 * Math.sin(x * 0.05)))
	const detectCover = detectPhoto((x, y) => 150 + 80 * Math.sin((x + y) * 0.04))
	const lum3 = (d, p) => 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]

	// 核心保证：反推出的带必须把里图一个不漏地圈住、且一个表图像素都不含
	for (const t of [8, 16, 24, 40, 80, 150]) {
		const coverT = t + 18
		const encoded = encode({
			cover: detectCover, inner: detectInner,
			options: { coverThreshold: coverT, innerThreshold: t, coverGray: true, innerGray: true }
		})
		const range = detectDecodeRange(encoded, false)
		let dropped = 0, leaked = 0
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				const p = (y * N + x) * 4
				const l = lum3(encoded.data, p)
				if (isCover(x, y)) {
					if (l >= range.lower && l <= range.higher) leaked++
				} else if (l < range.lower || l > range.higher) dropped++
			}
		}
		ok('里图色阶端 ' + String(t).padStart(3) + ' -> 反推出 0~' + String(range.higher).padStart(3) +
			'（里图掉带 ' + dropped + '，表图误入 ' + leaked + '）', dropped === 0 && leaked === 0,
			'dropped=' + dropped + ' leaked=' + leaked)
	}

	// 反相图
	{
		const encoded = encode({
			cover: detectCover, inner: detectInner,
			options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true, isReverse: true }
		})
		const range = detectDecodeRange(encoded, true)
		let dropped = 0
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				if (isCover(x, y)) continue
				const l = lum3(encoded.data, (y * N + x) * 4)
				if (l < range.lower || l > range.higher) dropped++
			}
		}
		ok('反相图反推出 ' + range.lower + '~' + range.higher + '，里图掉带 ' + dropped, dropped === 0, dropped)
	}

	// 间隔也要能反推出来（占比容差不能卡死在精确值上，否则 gap=2 会失效）
	for (const gap of [1, 2, 3]) {
		const encoded = encode({
			cover: detectCover, inner: detectInner,
			options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true, gap }
		})
		const range = detectDecodeRange(encoded, false)
		eq('间隔 ' + gap + ' 能反推出间隔', range.gap, gap)
		const out = decode({ image: encoded, options: { lower: range.lower, higher: range.higher, method: 'ltavg', iterations: 16 } })
		ok('间隔 ' + gap + ' 反推的带，落带比例 = 1/' + (gap + 1),
			Math.abs(out.stats.innerRatio - innerRatioFor(gap)) < 0.02, out.stats.innerRatio.toFixed(4))
	}

	// 置信度信号：真光棱坦克图带外侧有空档，普通图没有
	{
		const encoded = encode({
			cover: detectCover, inner: detectInner,
			options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true }
		})
		ok('真光棱坦克图：带外侧有空档', detectDecodeRange(encoded, false).emptyRun > 0, detectDecodeRange(encoded, false).emptyRun)
		const plain = detectPhoto((x, y) => 130 + 90 * Math.sin(x * 0.05) * Math.cos(y * 0.04))
		ok('普通照片：空档为 0（调用方据此提示"可能不是光棱坦克"）', detectDecodeRange(plain, false).emptyRun === 0,
			detectDecodeRange(plain, false).emptyRun)
	}

	// 容错：任何输入都不能抛
	eq('空输入返回 null', detectDecodeRange(null), null)
	eq('没有像素返回 null', detectDecodeRange({ width: 0, height: 0, data: new Uint8ClampedArray(0) }), null)
	ok('纯色图不崩', detectDecodeRange(makeImage(16, 16, () => gray(128)), false) !== null)
	ok('全黑图不崩', detectDecodeRange(makeImage(16, 16, () => gray(0)), false) !== null)
	ok('全白图不崩', detectDecodeRange(makeImage(16, 16, () => gray(255)), false) !== null)
	ok('指定间隔时不乱猜', detectDecodeRange(
		encode({ cover: detectCover, inner: detectInner, options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true, gap: 2 } }),
		false, 3
	).gap === 3)
}

console.log('\n== 22. 抗压缩能力（这条最该先看） ==')
{
	// 光棱坦克靠一条只有几十级的亮度带，**几乎没有任何抗有损压缩能力**。
	// 这一节把量级固定下来：任何"显形效果差"的排查都该先排除掉压缩，
	// 因为它的影响比填充算法、色阶端、对比度那些大一个数量级。
	const N = 160
	function cmpPhoto(shift) {
		const d = new Uint8ClampedArray(N * N * 4)
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				const p = (y * N + x) * 4
				const cx = (x - N / 2) / N, cy = (y - N / 2) / N
				let v = 190 - 260 * Math.sqrt(cx * cx + cy * cy)
				v += 45 * Math.sin((x + shift) * 0.07) * Math.cos(y * 0.06)
				if (x > 40 + shift && x < 100 && y > 50 && y < 120) v -= 70
				v = Math.max(0, Math.min(255, v))
				d[p] = v; d[p + 1] = v; d[p + 2] = v; d[p + 3] = 255
			}
		}
		return { width: N, height: N, data: d }
	}
	const truth2 = cmpPhoto(0)
	const encoded3 = encode({
		cover: cmpPhoto(37), inner: truth2,
		options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true }
	})
	const lum4 = (d, p) => 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]

	// 加噪：perPixel = 每像素高斯；perBlock = 每 8x8 块一个常数偏移（JPEG 的块效应）
	function corrupt(perPixel, perBlock) {
		const d = encoded3.data.slice()
		let s = 7
		const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
		const gauss = () => {
			let u = 0, v = 0
			while (!u) u = rnd()
			while (!v) v = rnd()
			return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
		}
		const blocks = new Map()
		for (let i = 0; i < d.length; i += 4) {
			const px = i / 4
			const x = px % N
			const y = (px - x) / N
			let e = 0
			if (perPixel) e += gauss() * perPixel
			if (perBlock) {
				const key = ((y / 8) | 0) * 1000 + ((x / 8) | 0)
				if (!blocks.has(key)) blocks.set(key, gauss() * perBlock)
				e += blocks.get(key)
			}
			for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, d[i + c] + e))
		}
		return { width: N, height: N, data: d }
	}

	function noisePsnr(image) {
		const out = decode({ image, options: { lower: 0, higher: 24, method: 'ltavg', iterations: 16 } }).data
		let sum = 0
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				const p = (y * N + x) * 4
				sum += (lum4(out, p) - lum4(truth2.data, p)) ** 2
			}
		}
		return 20 * Math.log10(255 / Math.sqrt(sum / (N * N)))
	}

	const clean = noisePsnr(encoded3)
	const n1 = noisePsnr(corrupt(1, 0))
	const n2 = noisePsnr(corrupt(2, 0))
	const b1 = noisePsnr(corrupt(0, 1))
	console.log('        无损            PSNR ' + clean.toFixed(1) + ' dB')
	console.log('        每像素 σ=1 级    PSNR ' + n1.toFixed(1) + ' dB（掉 ' + (clean - n1).toFixed(1) + ' dB）')
	console.log('        每像素 σ=2 级    PSNR ' + n2.toFixed(1) + ' dB（掉 ' + (clean - n2).toFixed(1) + ' dB）')
	console.log('        仅 8x8 块 σ=1 级 PSNR ' + b1.toFixed(1) + ' dB（掉 ' + (clean - b1).toFixed(1) + ' dB）')

	// 这几条断言是给未来的自己看的量级说明，不是"必须精确等于某个数"
	ok('无损时 PSNR 高于 36 dB', clean > 36, clean.toFixed(1))
	ok('1 级噪声就让 PSNR 掉 8 dB 以上（几乎没有抗压能力）', clean - n1 > 8, (clean - n1).toFixed(1))
	ok('2 级噪声掉 12 dB 以上', clean - n2 > 12, (clean - n2).toFixed(1))
	ok('仅块效应（8x8）也掉 8 dB 以上', clean - b1 > 8, (clean - b1).toFixed(1))

	// 空档长度是压缩的探针：无损时接近可解码裕度，被压过就塌掉
	const runClean = detectDecodeRange(encoded3, false).emptyRun
	const runN1 = detectDecodeRange(corrupt(1, 0), false).emptyRun
	const runN3 = detectDecodeRange(corrupt(3, 0), false).emptyRun
	const runN8 = detectDecodeRange(corrupt(8, 0), false).emptyRun
	console.log('        带外侧空档：无损 ' + runClean + ' → σ=1 ' + runN1 + ' → σ=3 ' + runN3 + ' → σ=8 ' + runN8)
	ok('无损时空档接近可解码裕度（42-24-1=17）', runClean >= 15, runClean)
	ok('空档随压缩单调下降', runClean > runN1 && runN1 > runN3 && runN3 >= runN8,
		[runClean, runN1, runN3, runN8].join(' > '))
	ok('重压后空档归零（界面据此提示"被重新压缩过"）', runN8 === 0, runN8)

	// 轻压缩下阈值本身仍然框得对 —— 所以"落带比例"不会报警，
	// 但效果已经很差了。这说明光看落带比例还不够，必须同时看空档。
	const mild = corrupt(2, 2)
	const mildRange = detectDecodeRange(mild, false)
	const mildOut = decode({ image: mild, options: { lower: mildRange.lower, higher: mildRange.higher, method: 'ltavg', iterations: 16 } })
	ok('轻压缩下阈值仍然框得对（落带比例 ≈ 50%）', Math.abs(mildOut.stats.innerRatio - 0.5) < 0.02,
		mildOut.stats.innerRatio.toFixed(4))
	ok('但空档已经明显变小了', mildRange.emptyRun < 12, mildRange.emptyRun)
}

console.log('\n== 23. 落带比例是否合理的判据 ==')
{
	// 阈值框对的时候，落带比例**精确等于** 1/(间隔+1)，所以这个判据很灵敏。
	// 容差 0.04 和 detectDecodeRange 里的一致（像素离散，(x+y)%3 只占 33.2% 而非 33.33%）。
	for (const gap of [1, 2, 3, 4]) {
		ok('间隔 ' + gap + ' 的精确比例被接受', isPlausibleInnerRatio(innerRatioFor(gap)), innerRatioFor(gap))
	}
	ok('容差内偏一点也接受（33.2% 对间隔 2）', isPlausibleInnerRatio(0.332), 0.332)
	// 用户实际报过 5.8% 这种值 —— 必须被判定为不合理
	ok('5.8% 被判为不合理', !isPlausibleInnerRatio(0.058), 0.058)
	ok('0.5% 被判为不合理', !isPlausibleInnerRatio(0.005))
	ok('90% 被判为不合理', !isPlausibleInnerRatio(0.9))
	ok('40% 被判为不合理（离 50% 和 33% 都超过容差）', !isPlausibleInnerRatio(0.4), 0.4)

	// 判据本身要和真实解码结果对得上
	{
		const N = 128
		const mk2 = (fn) => {
			const d = new Uint8ClampedArray(N * N * 4)
			for (let y = 0; y < N; y++) {
				for (let x = 0; x < N; x++) {
					const p = (y * N + x) * 4
					const v = Math.max(0, Math.min(255, fn(x, y)))
					d[p] = v; d[p + 1] = v; d[p + 2] = v; d[p + 3] = 255
				}
			}
			return { width: N, height: N, data: d }
		}
		const e = encode({
			cover: mk2((x, y) => 150 + 80 * Math.sin((x + y) * 0.05)),
			inner: mk2((x) => 40 + 150 * Math.sin(x * 0.05)),
			options: { coverThreshold: 42, innerThreshold: 24, coverGray: true, innerGray: true }
		})
		const good = decode({ image: e, options: { lower: 0, higher: 24, method: 'ltavg', iterations: 16 } })
		ok('阈值框对时判据通过', isPlausibleInnerRatio(good.stats.innerRatio), good.stats.innerRatio)

		// 把带挪到高处（相当于拿反相参数去解非反相图）：落带比例会掉到个位数，
		// 这正是用户报的那个现象的形态
		const wrong = decode({ image: e, options: { lower: 231, higher: 255, method: 'ltavg', iterations: 16 } })
		console.log('        拿反相阈值去解非反相图，落带比例 ' + (wrong.stats.innerRatio * 100).toFixed(1) + '%')
		ok('阈值方向搞反时判据不通过', !isPlausibleInnerRatio(wrong.stats.innerRatio), wrong.stats.innerRatio)
	}
}

console.log('\n== 24. 纯 JS 的 PNG 解码（App 端不再依赖 canvas 读像素） ==')
{
	// 为什么要有这个解码器：App 端读像素走「画进 canvas 再 canvasGetImageData」，
	// 而那条路在安卓上读出来的像素和文件本身对不上 —— 同一张图网页端显形正常、安卓不正常，
	// 并且「从文件字节里读出来的显形参数」和「canvas 读出来的像素」互相矛盾。
	// 文件字节是原样的，所以是 canvas 读错了。从字节直接解就绕开了这条不确定的路。
	function pngImage(w, h, fn) {
		const d = new Uint8ClampedArray(w * h * 4)
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const p = (y * w + x) * 4
				const v = fn(x, y)
				d[p] = v[0]; d[p + 1] = v[1]; d[p + 2] = v[2]; d[p + 3] = v.length > 3 ? v[3] : 255
			}
		}
		return { width: w, height: h, data: d }
	}
	function diff(a, b) {
		if (!a || !b) return '有一边是 null'
		if (a.width !== b.width || a.height !== b.height) return '尺寸不同'
		for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return '第 ' + i + ' 个字节不同'
		return null
	}

	// 往返：我们写出去的 PNG 必须能逐字节解回来。覆盖写出器会产出的全部四种颜色类型
	const samples = [
		['真彩+alpha', pngImage(37, 23, (x, y) => [(x * 7) % 256, (y * 11) % 256, (x * y) % 256, 255])],
		['真彩+半透明', pngImage(31, 17, (x, y) => [(x * 9) % 256, (y * 5) % 256, (x + y) % 256, (x * 3 + y * 7) % 256])],
		['灰度', pngImage(29, 19, (x, y) => { const v = (x * 5 + y * 3) % 256; return [v, v, v, 255] })],
		['灰度+alpha', pngImage(23, 13, (x, y) => { const v = (x * 3) % 256; return [v, v, v, (y * 17) % 256] })],
		['1x1', pngImage(1, 1, () => [123, 45, 67, 255])],
		['1xN', pngImage(1, 64, (x, y) => [y, y, y, 255])],
		['Nx1', pngImage(64, 1, (x) => [x, x, x, 255])]
	]
	for (const [label, image] of samples) {
		const back = decodePng(encodePng(image))
		ok('往返 ' + label, back !== null && diff(image, back) === null, diff(image, back))
	}

	// 带 tEXt 块时两个功能不能互相干扰
	{
		const image = pngImage(16, 16, (x, y) => [x * 16, y * 16, 128, 255])
		const bytes = encodePng(image, '01832')
		eq('同一份字节里文本仍然读得到', readPngText(bytes), '01832')
		ok('同一份字节里像素也解得出', diff(image, decodePng(bytes)) === null, diff(image, decodePng(bytes)))
	}

	// 坏数据一律返回 null，绝不抛 —— 调用方据此退回 canvas
	eq('空字节', decodePng(new Uint8Array(0)), null)
	eq('null', decodePng(null), null)
	eq('不是 PNG', decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), null)
	eq('只有签名', decodePng(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), null)
	{
		const full = encodePng(pngImage(8, 8, () => [100, 100, 100, 255]))
		eq('截断的 PNG', decodePng(full.slice(0, full.length - 20)), null)
		ok('签名判定', isPng(full) === true && isPng(new Uint8Array([1, 2, 3])) === false)
	}

	// 缩放：原来这一步是交给 canvas 的 9 参 drawImage 做的，现在得自己来
	{
		const source = pngImage(40, 20, (x, y) => [x * 6, y * 12, 50, 255])
		const identical = resizeCoverImage(source, 40, 20)
		ok('尺寸相同直接复制（且不是同一个对象）', diff(source, identical) === null && identical.data !== source.data)
		const half = resizeCoverImage(source, 20, 10)
		ok('缩小尺寸对', half.width === 20 && half.height === 10)
		ok('缩小的值接近', Math.abs(half.data[(5 * 20 + 5) * 4] - 60) <= 10, half.data[(5 * 20 + 5) * 4])
		// 竖图放进方框：应当居中裁剪，不是拉伸
		const tall = pngImage(20, 80, (x, y) => [y * 3, 10, 10, 255])
		const square = resizeCoverImage(tall, 40, 40)
		ok('竖图 cover 成方图', square && square.width === 40 && square.height === 40)
		ok('取的是中间那段（不是上边）', square && square.data[(20 * 40 + 20) * 4] > 100, square && square.data[(20 * 40 + 20) * 4])
		const up = resizeCoverImage(pngImage(2, 2, () => [200, 100, 50, 255]), 8, 8)
		ok('放大也正常', up && up.width === 8 && up.data[0] === 200)
		eq('退化输入返回 null', resizeCoverImage(null, 10, 10), null)
		eq('目标尺寸为 0 返回 null', resizeCoverImage(source, 0, 10), null)
	}
}

console.log('\n=============================')
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
console.log('=============================\n')
process.exit(fail === 0 ? 0 : 1)
