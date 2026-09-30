<template>
	<view class="tool-slider" :class="{ 'tool-slider-spaced': spaced }">
		<view class="ts-head">
			<text class="ts-label">{{ label }}</text>
			<text class="ts-value" :class="{ 'ts-value-active': dragging }">{{ current }}</text>
		</view>

		<!--
			命中区。**整条轨道都能按，按下即跳到手指所在的位置** —— 原生 <slider> 只有那个
			十几像素的小圆点能按、轨道又细，手指按不准，这正是「不好拖」的根因。
			.stop 在小程序端编译成 catchtouchmove（挡住页面跟着滚），.prevent 在 H5 / App 端
			调 preventDefault（同一个作用）—— 三端各取所需，缺一个就有一端会滚。
		-->
		<view
			class="ts-hit"
			@touchstart.stop.prevent="onTouchStart"
			@touchmove.stop.prevent="onTouchMove"
			@touchend="onTouchEnd"
			@touchcancel="onTouchEnd"
		>
			<view class="ts-rail" :id="railId">
				<view class="ts-fill" :style="{ width: percent + '%' }"></view>
				<view
					class="ts-thumb"
					:class="{ 'ts-thumb-active': dragging }"
					:style="{ left: percent + '%' }"
				></view>
			</view>
		</view>
	</view>
</template>

<script>
	import { snapToStep, valueToRatio, clientXToValue } from '@/common/sliderMath.js'

	// 每个实例一个唯一 id。正常情况下查询是绑在组件实例上的（见 measureTrack），
	// 但万一 .in() 在某个端退化成页面级查询，按 id 选也只会选中自己那条轨道，
	// 不会像类选择器那样选中页面上第一个滑块而整体错位
	let railSeed = 0

	/**
	 * 通用滑块：受控（value + changing/change），观感按项目 UI 规范来。
	 *
	 * 事件契约刻意**和原生 <slider> 不同**：changing / change 直接抛 Number，不伪造
	 * {detail:{value}} —— 页面里 <switch> 的 handler 仍然收原生事件对象，两种形状不同
	 * 反而更容易分辨哪些 handler 属于滑块。
	 *
	 * 取值换算全在 common/sliderMath.js（纯逻辑，有测试）；这里只做触摸、量测和渲染。
	 */
	export default {
		name: 'tool-slider',
		props: {
			label: { type: String, default: '' },
			value: { type: Number, default: 0 },
			min: { type: Number, default: 0 },
			max: { type: Number, default: 100 },
			step: { type: Number, default: 1 },
			// 同一张卡片里不是第一行时打开，替代原来的 .row-spaced
			spaced: { type: Boolean, default: false }
		},
		emits: ['changing', 'change'],
		data() {
			return {
				// 组件自己的当前值。拖动时先更新它，不等父级回流 —— 小程序端 prop 回流
				// 有往返延迟，等它回来握把就不跟手了
				current: 0,
				percent: 0,
				dragging: false,
				railId: 'ts-rail-' + (++railSeed),
				// 轨道的位置和宽度（px，viewport 相对）。width 为 0 表示还没量到
				trackLeft: 0,
				trackWidth: 0,
				// 这次触摸里值有没有变过。判据必须是它，不能拿「松手值和按下值是否相等」代替，
				// 理由见 onTouchEnd
				moved: false,
				// 已经抛出去的值：同一个整数档位不重复抛
				lastEmitted: 0
			}
		},
		watch: {
			// 外部直接改值（预填制作参数 / 自动检测阈值 / 重置对比度）时握把要跟过去。
			// 拖动中不接管：那一路的值由手指说了算，外部回流晚到不该把手指拽回去
			value() { this.syncFromProp() },
			min() { this.syncFromProp() },
			max() { this.syncFromProp() },
			step() { this.syncFromProp() }
		},
		mounted() {
			this.syncFromProp()
			// 挂载后量一次并缓存。**不能等 touchstart 里现查**：exec() 是异步的，
			// 第一次 touchmove 会赶在回调之前到
			this.measureTrack()
		},
		methods: {
			syncFromProp() {
				if (this.dragging) return
				const value = snapToStep(this.value, this.min, this.max, this.step)
				this.current = value
				this.percent = valueToRatio(value, this.min, this.max) * 100
			},

			/**
			 * 量轨道的位置和宽度，缓存给换算用。
			 * 水平位置不随纵向滚动变化，所以挂载时量一次就一直有效；touchstart 里再刷一次，
			 * 兜住窗口尺寸变化、条件渲染后重新布局这类情况。
			 */
			measureTrack(done) {
				// 组件内查节点要绑实例：Vue3 小程序端用 this.$scope，H5 端没有 $scope
				// 要退回 this。两条路都不含平台判断，是 uni 的通用 API
				const scope = this.$scope || this
				uni.createSelectorQuery().in(scope).select('#' + this.railId).boundingClientRect((rect) => {
					if (!rect || !rect.width) return
					this.trackLeft = rect.left
					this.trackWidth = rect.width
					if (typeof done === 'function') done()
				}).exec()
			},

			/**
			 * 触点横坐标。**必须用 clientX**：它和 boundingClientRect 同为 viewport 相对，
			 * 换成 pageX 会在页面滚动后整体错位。取不到就返回 null，跳过这一帧。
			 */
			touchClientX(event) {
				const touch = (event.touches && event.touches[0]) ||
					(event.changedTouches && event.changedTouches[0])
				// 刻意用 typeof 判而不是 isFinite()：isFinite(null) 是 true，会把「没有坐标」
				// 当成 0 算出一个贴在左端的值
				if (!touch || typeof touch.clientX !== 'number' || !isFinite(touch.clientX)) return null
				return touch.clientX
			},

			valueAt(clientX) {
				return clientXToValue(clientX, { left: this.trackLeft, width: this.trackWidth },
					this.min, this.max, this.step)
			},

			onTouchStart(event) {
				this.dragging = true
				this.moved = false
				// 原地按一下不算改过值，省掉一次没必要的全分辨率重算
				this.lastEmitted = this.current

				const clientX = this.touchClientX(event)
				if (clientX === null) return

				const value = this.valueAt(clientX)
				if (value !== null) {
					this.applyDragValue(value)
					this.measureTrack()
					return
				}
				// 极罕见：挂载那次量测还没落地就被按了。量完把这一下补上，别丢掉
				this.measureTrack(() => {
					const late = this.valueAt(clientX)
					if (late !== null) this.applyDragValue(late)
				})
			},

			onTouchMove(event) {
				if (!this.dragging) return
				const clientX = this.touchClientX(event)
				if (clientX === null) return
				const value = this.valueAt(clientX)
				if (value !== null) this.applyDragValue(value)
			},

			onTouchEnd() {
				if (!this.dragging) return
				this.dragging = false
				// 判据是「这次触摸里值变过没有」，**不能**写成「松手时的值和按下时不同」：
				// 拖走再拖回原值，两者相等，可中途已经抛过 changing，页面那边已经把
				// staleFull 立起来了 —— 这时不发 change 就没人去解除它，「保存」会一直灰着、
				// 提示一直说正在重算，其实什么都没在跑。
				// 反过来，原地按一下没改变值就不发 change，省掉一次白跑的全分辨率重算。
				if (this.moved) this.$emit('change', this.current)
			},

			applyDragValue(value) {
				this.current = value
				this.percent = valueToRatio(value, this.min, this.max) * 100
				// 整数档位去重：同一个值不重复抛，touchmove 的冗余天然被收敛成「值变化次数」。
				// 这里刻意不做时间节流 —— 节流会推迟甚至丢掉松手前那最后一帧
				if (value !== this.lastEmitted) {
					this.lastEmitted = value
					this.moved = true
					this.$emit('changing', value)
				}
			}
		}
	}
</script>

<style scoped>
	.tool-slider-spaced {
		margin-top: 32rpx;
	}

	.ts-head {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}

	.ts-label {
		font-size: 30rpx;
		font-weight: 500;
		color: #1F2329;
	}

	.ts-value {
		min-width: 72rpx;
		padding: 4rpx 18rpx;
		text-align: center;
		font-size: 24rpx;
		color: #5B8FF9;
		background-color: #EEF3FE;
		border-radius: 999rpx;
	}

	/* 拖动时数值胶囊反色：手指挡着轨道的时候，这是「现在停在哪个值」的唯一反馈 */
	.ts-value-active {
		color: #FFFFFF;
		background-color: #5B8FF9;
	}

	.ts-hit {
		position: relative;
		height: 80rpx;
		/* 左右各让出半个握把宽：握把拖到两端时不会越出命中区 */
		padding: 0 20rpx;
		display: flex;
		flex-direction: row;
		align-items: center;
	}

	/* 注意不要加 overflow: hidden，会把握把裁掉 —— 已填充段自己用圆角收口 */
	.ts-rail {
		position: relative;
		flex: 1;
		height: 12rpx;
		background-color: #ECEDF2;
		border-radius: 999rpx;
	}

	.ts-fill {
		position: absolute;
		left: 0;
		top: 0;
		height: 100%;
		background-color: #5B8FF9;
		border-radius: 999rpx;
	}

	.ts-thumb {
		position: absolute;
		top: 50%;
		width: 40rpx;
		height: 40rpx;
		/* 居中只用这一套变换：translateX 的百分比按自身宽度算，放大时会自动重算，
		   所以不要再用 margin 去补半个增量 —— 那样反而会偏心 */
		transform: translate(-50%, -50%);
		background-color: #FFFFFF;
		border-radius: 50%;
		box-shadow: 0 2rpx 8rpx rgba(31, 35, 41, 0.18);
	}

	.ts-thumb-active {
		transform: translate(-50%, -50%) scale(1.15);
	}
</style>
