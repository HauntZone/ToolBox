<template>
	<view class="page">
		<view class="card">
			<text class="label">文本内容</text>
			<textarea
				v-model="text"
				class="input"
				:maxlength="maxLength"
				placeholder="输入文本或网址，例如 https://uniapp.dcloud.net.cn"
				placeholder-class="placeholder"
				:auto-height="true"
			/>
			<view class="input-footer">
				<text class="count">{{ text.length }}/{{ maxLength }}</text>
				<text v-if="text" class="clear" @click="text = ''">清空</text>
			</view>
		</view>

		<view class="card">
			<text class="label">容错级别</text>
			<text class="hint">级别越高越抗污损，可容纳的内容越少</text>
			<view class="levels">
				<view
					v-for="item in levels"
					:key="item.value"
					class="level"
					:class="{ 'level-active': item.value === level }"
					@click="selectLevel(item.value)"
				>
					<text class="level-name">{{ item.value }}</text>
					<text class="level-desc">{{ item.desc }}</text>
				</view>
			</view>
		</view>

		<view class="preview">
			<!-- 画布尺寸必须与 qr.size 一致，否则二维码会画歪 -->
			<canvas canvas-id="qrcode" id="qrcode" class="qrcode" :style="canvasStyle"></canvas>
			<text v-if="!generated" class="preview-tip">输入内容后点击下方按钮生成</text>
		</view>

		<view class="actions">
			<button class="btn btn-primary" :disabled="!text.trim()" @click="generate">生成二维码</button>
			<button class="btn btn-plain" :disabled="!generated" @click="save">保存图片</button>
		</view>
	</view>
</template>

<script>
	import UQRCode from '@/common/uqrcode.esm.js'

	export default {
		data() {
			return {
				text: '',
				maxLength: 500,
				level: 'M',
				size: 240,
				canvasStyle: 'width: 240px; height: 240px;',
				generated: false,
				drawing: false,
				levels: [
					{ value: 'L', desc: '7%' },
					{ value: 'M', desc: '15%' },
					{ value: 'Q', desc: '25%' },
					{ value: 'H', desc: '30%' }
				]
			}
		},
		onLoad() {
			// 画布用 px 定尺寸，按屏幕宽度算一个合适的边长
			const width = uni.getSystemInfoSync().windowWidth
			const size = Math.round(Math.min(280, Math.max(180, width * 0.62)))
			this.size = size
			this.canvasStyle = 'width: ' + size + 'px; height: ' + size + 'px;'
		},
		methods: {
			async generate() {
				const data = this.text.trim()
				if (!data) {
					uni.showToast({ title: '请输入要生成的内容', icon: 'none' })
					return
				}
				if (this.drawing) return
				this.drawing = true
				uni.showLoading({ title: '生成中...' })
				try {
					const qr = new UQRCode()
					qr.data = data
					qr.size = this.size
					qr.margin = 12
					qr.errorCorrectLevel = UQRCode.errorCorrectLevel[this.level]
					qr.make()
					// 画布就在本页面里，不需要传组件实例
					qr.canvasContext = uni.createCanvasContext('qrcode')
					// drawCanvas 内部会等渲染完成再 resolve
					await qr.drawCanvas()
					this.generated = true
					uni.hideLoading()
				} catch (error) {
					console.error('[qrcode] 生成失败', error)
					this.generated = false
					uni.hideLoading()
					uni.showToast({ title: '生成失败，内容可能过长', icon: 'none' })
				}
				this.drawing = false
			},
			selectLevel(value) {
				if (this.level === value) return
				this.level = value
				// 已经生成过就按新级别重画一张
				if (this.generated) this.generate()
			},
			save() {
				if (!this.generated) {
					uni.showToast({ title: '请先生成二维码', icon: 'none' })
					return
				}

				// #ifdef H5
				// H5 没有相册，改为直接下载图片
				const canvas = document.querySelector('canvas')
				if (!canvas) return
				const link = document.createElement('a')
				link.href = canvas.toDataURL('image/png')
				link.download = 'qrcode.png'
				link.click()
				// #endif

				// #ifndef H5
				uni.canvasToTempFilePath({
					canvasId: 'qrcode',
					success: (res) => {
						uni.saveImageToPhotosAlbum({
							filePath: res.tempFilePath,
							success: () => uni.showToast({ title: '已保存到相册' }),
							fail: () => uni.showToast({ title: '保存失败，请检查相册权限', icon: 'none' })
						})
					},
					fail: () => uni.showToast({ title: '导出图片失败', icon: 'none' })
				})
				// #endif
			}
		}
	}
</script>

<style>
	.page {
		min-height: 100vh;
		padding: 32rpx 24rpx 48rpx;
		box-sizing: border-box;
		background-color: #F5F6FA;
	}

	.card {
		margin-bottom: 24rpx;
		padding: 32rpx 28rpx;
		background-color: #FFFFFF;
		border-radius: 20rpx;
		box-shadow: 0 4rpx 16rpx rgba(31, 35, 41, 0.06);
	}

	.label {
		display: block;
		font-size: 30rpx;
		font-weight: 500;
		color: #1F2329;
	}

	.hint {
		display: block;
		margin-top: 10rpx;
		font-size: 24rpx;
		color: #8F9299;
	}

	.input {
		width: 100%;
		min-height: 120rpx;
		margin-top: 20rpx;
		font-size: 28rpx;
		line-height: 42rpx;
		color: #1F2329;
	}

	.placeholder {
		color: #B6BAC3;
	}

	.input-footer {
		margin-top: 12rpx;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}

	.count {
		font-size: 24rpx;
		color: #B6BAC3;
	}

	.clear {
		font-size: 26rpx;
		color: #5B8FF9;
	}

	.levels {
		margin-top: 20rpx;
		display: flex;
		flex-direction: row;
	}

	.level {
		flex: 1;
		margin-right: 16rpx;
		padding: 16rpx 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		background-color: #F2F3F7;
		border-radius: 16rpx;
	}

	.level:last-child {
		margin-right: 0;
	}

	.level-active {
		background-color: #E8F0FE;
	}

	.level-name {
		font-size: 30rpx;
		font-weight: 500;
		color: #5A5F6B;
	}

	.level-active .level-name {
		color: #5B8FF9;
	}

	.level-desc {
		margin-top: 6rpx;
		font-size: 22rpx;
		color: #8F9299;
	}

	.preview {
		padding: 40rpx 0;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.qrcode {
		background-color: #FFFFFF;
		border-radius: 16rpx;
	}

	.preview-tip {
		margin-top: 24rpx;
		font-size: 24rpx;
		color: #8F9299;
	}

	.actions {
		display: flex;
		flex-direction: row;
	}

	.btn {
		flex: 1;
		margin: 0 8rpx;
		font-size: 30rpx;
		border-radius: 44rpx;
	}

	.btn-primary {
		background-color: #5B8FF9;
		color: #FFFFFF;
	}

	.btn-primary[disabled] {
		background-color: #B9CFFB;
		color: #FFFFFF;
	}

	.btn-plain {
		background-color: #FFFFFF;
		color: #5A5F6B;
	}

	.btn-plain[disabled] {
		color: #B6BAC3;
	}
</style>
