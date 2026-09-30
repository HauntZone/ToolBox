/**
 * common/sliderMath.js 的验证。跑法见 test/README.md。
 *
 * 这个文件盯的都是**真会出错**的地方，不是凑覆盖率：
 *   - 对比度 min=-255 / step=5 时两端恰好可达、中间对齐到整数（浮点尾巴在这里现形）
 *   - 阈值类 0~255 / step=1 每个整数都有对应的触点区间（手指能停到任意一个具体值）
 *   - 量不到轨道时返回 null 而不是 NaN
 *   - 触点跑到轨道外面要夹到两端
 */
import { snapToStep, valueToRatio, clientXToValue } from './sliderMath.js'

let pass = 0
let fail = 0
function ok(name, cond, extra) {
	if (cond) { pass++; console.log('  PASS  ' + name) }
	else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')) }
}
function eq(name, actual, expected) {
	ok(name + ' = ' + expected, actual === expected, 'got ' + actual)
}

console.log('\n== 1. 按步长对齐 ==')
{
	eq('整数区间取整', snapToStep(42.4, 4, 254, 1), 42)
	eq('整数区间进位', snapToStep(42.6, 4, 254, 1), 43)

	// 对比度：min=-255 / max=255 / step=5（prismTank 的 LIMITS.contrastRange/contrastStep）
	eq('对比度下界恰好可达', snapToStep(-999, -255, 255, 5), -255)
	eq('对比度上界恰好可达', snapToStep(999, -255, 255, 5), 255)
	eq('对比度中点对齐到 0', snapToStep(1.9, -255, 255, 5), 0)
	eq('对比度往上对齐到 5', snapToStep(4, -255, 255, 5), 5)
	eq('对比度往下对齐到 -5', snapToStep(-4, -255, 255, 5), -5)
	// 255 必须是 5 的倍数才让两端同时可达；这条钉住的是「先对齐再夹紧」这个顺序
	ok('对比度两端都落在 5 的倍数上', (-255) % 5 === 0 && 255 % 5 === 0)

	// 浮点尾巴：-255 + 102*5 直接算出来是 255.00000000000003
	ok('对齐后没有浮点尾巴', String(snapToStep(255, -255, 255, 5)) === '255', String(snapToStep(255, -255, 255, 5)))
	ok('中间值也没有浮点尾巴',
		String(snapToStep(-250, -255, 255, 5)) === '-250',
		String(snapToStep(-250, -255, 255, 5)))

	// gap = 1~4，slope = 0~4
	eq('gap 下界', snapToStep(4, 1, 4, 1), 4)
	eq('gap 越界夹到 1', snapToStep(-3, 1, 4, 1), 1)
	eq('slope 下界是 0 不是 1', snapToStep(-1, 0, 4, 1), 0)

	// 坏参数不能让整行变成 NaN
	eq('step=0 按 1 处理', snapToStep(42.6, 0, 255, 0), 43)
	eq('step 为负按 1 处理', snapToStep(42.6, 0, 255, -5), 43)
	eq('step 为 NaN 按 1 处理', snapToStep(42.6, 0, 255, NaN), 43)
	eq('value 为 NaN 退回下界', snapToStep(NaN, 0, 255, 1), 0)
	eq('min 为 0 时 0 是合法值', snapToStep(0, 0, 255, 1), 0)
}

console.log('\n== 2. 值 -> 位置 ==')
{
	eq('下界在 0 处', valueToRatio(0, 0, 255), 0)
	eq('上界在 1 处', valueToRatio(255, 0, 255), 1)
	eq('中点在 0.5 处', valueToRatio(127.5, 0, 255), 0.5)
	// 对比度是负下界，位置必须按 [-255,255] 算，0 落在正中间
	eq('对比度 0 在正中间', valueToRatio(0, -255, 255), 0.5)
	eq('对比度下界在 0 处', valueToRatio(-255, -255, 255), 0)
	// max === min 不能除零
	eq('max === min 不炸', valueToRatio(5, 5, 5), 0)
	ok('max === min 得到有限数', isFinite(valueToRatio(5, 5, 5)))
}

console.log('\n== 3. 触点 -> 值 ==')
{
	// 轨道 300px 宽，从 x=100 开始
	const rect = { left: 100, width: 300 }

	eq('按在最左端', clientXToValue(100, rect, 0, 255, 1), 0)
	eq('按在最右端', clientXToValue(400, rect, 0, 255, 1), 255)
	eq('按在正中间', clientXToValue(250, rect, 0, 255, 1), 128)
	eq('按在轨道左边外面夹到 0', clientXToValue(20, rect, 0, 255, 1), 0)
	eq('按在轨道右边外面夹到 255', clientXToValue(999, rect, 0, 255, 1), 255)

	// 量不到轨道时必须是 null，调用方据此跳过这一帧
	eq('width 为 0 返回 null', clientXToValue(200, { left: 100, width: 0 }, 0, 255, 1), null)
	eq('rect 为 null 返回 null', clientXToValue(200, null, 0, 255, 1), null)
	eq('left 缺失返回 null', clientXToValue(200, { width: 300 }, 0, 255, 1), null)
	eq('clientX 为 undefined 返回 null', clientXToValue(undefined, rect, 0, 255, 1), null)

	// 0~255 / step=1：每个整数档位都要有对应的触点位置，否则「拖不准具体值」
	let reached = 0
	for (let v = 0; v <= 255; v++) {
		const x = rect.left + rect.width * (v / 255)
		if (clientXToValue(x, rect, 0, 255, 1) === v) reached++
	}
	eq('0~255 每个整数都能被命中', reached, 256)

	// 320pt 屏上轨道约 258px —— 这是现实里最窄的一档，同样要全部命中
	const narrow = { left: 12, width: 258 }
	let reachedNarrow = 0
	for (let v = 0; v <= 255; v++) {
		const x = narrow.left + narrow.width * (v / 255)
		if (clientXToValue(x, narrow, 0, 255, 1) === v) reachedNarrow++
	}
	eq('窄屏（258px）上也能命中全部 256 档', reachedNarrow, 256)

	// 对比度在负区间上同样要能走完整条轨道
	eq('对比度最左是 -255', clientXToValue(100, rect, -255, 255, 5), -255)
	eq('对比度最右是 255', clientXToValue(400, rect, -255, 255, 5), 255)

	// gap 只有 1~4 四档：整条轨道划成 4 段
	eq('gap 按在 1/8 处是 1', clientXToValue(100 + 300 * 0.125, rect, 1, 4, 1), 1)
	eq('gap 按在 3/8 处是 2', clientXToValue(100 + 300 * 0.375, rect, 1, 4, 1), 2)
	eq('gap 按在 7/8 处是 4', clientXToValue(100 + 300 * 0.875, rect, 1, 4, 1), 4)
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项')
process.exit(fail ? 1 : 0)
