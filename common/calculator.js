/**
 * 计算器运算内核，不涉及任何 UI，便于复用和单独验证。
 *
 * 采用「即时运算」模型：按下运算符时就把上一次的结果算出来，
 * 所以任意时刻最多只有一个待处理的运算符（就是手机自带计算器的手感）。
 */

const MAX_INPUT_LENGTH = 12

function apply(a, b, op) {
	switch (op) {
		case '+':
			return a + b
		case '-':
			return a - b
		case '×':
			return a * b
		case '÷':
			// 除以零无法表示，交给调用方处理
			return b === 0 ? null : a / b
		default:
			return b
	}
}

// 保留 12 位有效数字，顺手抹掉 0.1 + 0.2 = 0.30000000000000004 这类浮点误差
export function toNumberText(value) {
	if (!isFinite(value)) return '错误'
	return String(Number(value.toPrecision(12)))
}

// 仅用于显示：给整数部分加千分位，方便读长数字
export function formatDisplay(text) {
	if (!text || text === '错误' || text.indexOf('e') !== -1) return text
	const negative = text.charAt(0) === '-'
	const body = negative ? text.slice(1) : text
	const parts = body.split('.')
	const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	return (negative ? '-' : '') + (parts.length > 1 ? grouped + '.' + parts[1] : grouped)
}

export default class Calculator {
	constructor() {
		this.clear()
	}

	clear() {
		this.current = '0' // 当前正在输入/显示的数字，用字符串保留用户输入的小数点
		this.accumulator = null // 上一个操作数
		this.pendingOp = null // 待执行的运算符
		this.expression = '' // 显示在结果上方的算式
		this.overwrite = true // 下一次输入数字时是否覆盖 current
		this.lastOp = null // 连按等号时重复使用的运算符
		this.lastOperand = null
	}

	get hasError() {
		return this.current === '错误'
	}

	inputDigit(digit) {
		if (this.hasError) this.clear()
		if (this.overwrite) {
			this.beginEntry(digit)
			return
		}
		// 前导零：0 之后直接输入数字应当替换掉，而不是拼成 05
		if (/^-?0$/.test(this.current)) {
			this.current = this.current.charAt(0) === '-' ? '-' + digit : digit
			return
		}
		if (this.digitCount() >= MAX_INPUT_LENGTH) return
		this.current += digit
	}

	inputDot() {
		if (this.hasError) this.clear()
		if (this.overwrite) {
			this.beginEntry('0.')
			return
		}
		if (this.current.indexOf('.') === -1) this.current += '.'
	}

	setOperator(op) {
		if (this.hasError) return
		// 连按运算符时只替换运算符，不重复计算
		if (this.pendingOp !== null && this.overwrite) {
			this.pendingOp = op
			this.expression = toNumberText(this.accumulator) + ' ' + op
			return
		}
		const value = Number(this.current)
		if (this.pendingOp !== null) {
			const result = apply(this.accumulator, value, this.pendingOp)
			if (result === null) return this.fail()
			this.accumulator = result
		} else {
			this.accumulator = value
		}
		this.current = toNumberText(this.accumulator)
		this.pendingOp = op
		this.expression = toNumberText(this.accumulator) + ' ' + op
		this.overwrite = true
		// 输入了新算式，上一次的连按等号记录作废
		this.lastOp = null
		this.lastOperand = null
	}

	equals() {
		if (this.hasError) return
		let left, op, right
		if (this.pendingOp !== null) {
			left = this.accumulator
			op = this.pendingOp
			right = Number(this.current)
		} else if (this.lastOp !== null) {
			// 连按等号：拿当前结果重复上一次运算
			left = Number(this.current)
			op = this.lastOp
			right = this.lastOperand
		} else {
			return
		}
		const result = apply(left, right, op)
		if (result === null) return this.fail()
		this.lastOp = op
		this.lastOperand = right
		this.expression = toNumberText(left) + ' ' + op + ' ' + toNumberText(right) + ' ='
		this.current = toNumberText(result)
		this.accumulator = null
		this.pendingOp = null
		this.overwrite = true
	}

	percent() {
		if (this.hasError) return
		this.current = toNumberText(Number(this.current) / 100)
		this.overwrite = true
	}

	toggleSign() {
		if (this.hasError) return
		if (this.current.charAt(0) === '-') {
			this.current = this.current.slice(1)
		} else if (Number(this.current) !== 0) {
			this.current = '-' + this.current
		}
		// 取反算作一次输入完成，之后输入数字会重新开始
		this.overwrite = true
	}

	backspace() {
		if (this.hasError) {
			this.clear()
			return
		}
		// 显示的是上一次的计算结果，不支持逐位删除
		if (this.overwrite) return
		this.current = this.current.slice(0, -1)
		if (this.current === '' || this.current === '-') this.current = '0'
	}

	fail() {
		this.clear()
		this.current = '错误'
		this.expression = '不能除以零'
	}

	// 开始输入一个新数字，同时清掉上一次结果的痕迹
	beginEntry(digit) {
		this.current = digit
		this.overwrite = false
		if (this.lastOp !== null) {
			this.lastOp = null
			this.lastOperand = null
			this.expression = ''
		}
	}

	digitCount() {
		return this.current.replace(/[-.]/g, '').length
	}
}
