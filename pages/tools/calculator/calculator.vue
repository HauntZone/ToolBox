<template>
	<view class="page">
		<view class="display">
			<text class="expression">{{ expression }}</text>
			<text class="result" :class="{ 'result-error': isError }" :style="{ fontSize: resultFontSize }">{{ display }}</text>
		</view>

		<view class="keypad">
			<view v-for="(row, rowIndex) in keypad" :key="rowIndex" class="keypad-row">
				<view
					v-for="key in row"
					:key="key.label"
					class="key"
					:class="'key-' + (key.kind || 'num')"
					hover-class="key-hover"
					:hover-stay-time="60"
					@click="handleKey(key)"
				>
					<text class="key-text">{{ key.label }}</text>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import Calculator, { formatDisplay } from '@/common/calculator.js'

	export default {
		data() {
			return {
				display: '0',
				expression: '',
				isError: false,
				keypad: [
					[
						{ label: 'AC', action: 'clear', kind: 'fn' },
						{ label: '⌫', action: 'backspace', kind: 'fn' },
						{ label: '%', action: 'percent', kind: 'fn' },
						{ label: '÷', action: 'operator', value: '÷', kind: 'op' }
					],
					[
						{ label: '7', action: 'digit', value: '7' },
						{ label: '8', action: 'digit', value: '8' },
						{ label: '9', action: 'digit', value: '9' },
						{ label: '×', action: 'operator', value: '×', kind: 'op' }
					],
					[
						{ label: '4', action: 'digit', value: '4' },
						{ label: '5', action: 'digit', value: '5' },
						{ label: '6', action: 'digit', value: '6' },
						{ label: '-', action: 'operator', value: '-', kind: 'op' }
					],
					[
						{ label: '1', action: 'digit', value: '1' },
						{ label: '2', action: 'digit', value: '2' },
						{ label: '3', action: 'digit', value: '3' },
						{ label: '+', action: 'operator', value: '+', kind: 'op' }
					],
					[
						{ label: '±', action: 'sign', kind: 'fn' },
						{ label: '0', action: 'digit', value: '0' },
						{ label: '.', action: 'dot' },
						{ label: '=', action: 'equals', kind: 'eq' }
					]
				]
			}
		},
		computed: {
			resultFontSize() {
				const length = this.display.length
				if (length > 12) return '48rpx'
				if (length > 9) return '64rpx'
				return '80rpx'
			}
		},
		created() {
			// 内核不需要响应式，每次操作后把结果同步到 data 里
			this.calculator = new Calculator()
		},
		methods: {
			handleKey(key) {
				const wasError = this.calculator.hasError
				switch (key.action) {
					case 'digit':
						this.calculator.inputDigit(key.value)
						break
					case 'dot':
						this.calculator.inputDot()
						break
					case 'operator':
						this.calculator.setOperator(key.value)
						break
					case 'equals':
						this.calculator.equals()
						break
					case 'percent':
						this.calculator.percent()
						break
					case 'sign':
						this.calculator.toggleSign()
						break
					case 'backspace':
						this.calculator.backspace()
						break
					case 'clear':
						this.calculator.clear()
						break
				}
				this.sync()
				// 只在这条算式刚刚出错时提示，避免连按运算符时反复弹
				if (!wasError && this.calculator.hasError) {
					uni.showToast({ title: '不能除以零', icon: 'none' })
				}
			},
			sync() {
				this.display = formatDisplay(this.calculator.current) || '0'
				this.expression = formatDisplay(this.calculator.expression)
				this.isError = this.calculator.hasError
			}
		}
	}
</script>

<style>
	.page {
		min-height: 100vh;
		padding: 32rpx 24rpx;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		background-color: #F5F6FA;
	}

	.display {
		flex: 1;
		min-height: 240rpx;
		padding: 48rpx 36rpx;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: flex-end;
		background-color: #FFFFFF;
		border-radius: 24rpx;
		box-shadow: 0 4rpx 16rpx rgba(31, 35, 41, 0.06);
	}

	.expression {
		max-width: 100%;
		font-size: 30rpx;
		color: #8F9299;
		word-break: break-all;
		text-align: right;
	}

	.result {
		max-width: 100%;
		margin-top: 20rpx;
		font-weight: 500;
		color: #1F2329;
		word-break: break-all;
		text-align: right;
	}

	.result-error {
		color: #E8684A;
	}

	.keypad {
		margin-top: 24rpx;
	}

	.keypad-row {
		display: flex;
		flex-direction: row;
	}

	.key {
		flex: 1;
		height: 116rpx;
		margin: 8rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: #FFFFFF;
		border-radius: 20rpx;
		box-shadow: 0 4rpx 12rpx rgba(31, 35, 41, 0.05);
	}

	.key-hover {
		opacity: 0.7;
	}

	.key-text {
		font-size: 40rpx;
		color: #1F2329;
	}

	.key-fn {
		background-color: #EDEEF2;
		box-shadow: none;
	}

	.key-fn .key-text {
		font-size: 34rpx;
		color: #5A5F6B;
	}

	.key-op .key-text {
		color: #5B8FF9;
		font-weight: 500;
	}

	.key-eq {
		background-color: #5B8FF9;
		box-shadow: none;
	}

	.key-eq .key-text {
		color: #FFFFFF;
		font-weight: 500;
	}
</style>
