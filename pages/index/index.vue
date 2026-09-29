<template>
	<view class="page">
		<view class="header">
			<text class="header-title">工具箱</text>
			<text class="header-desc">常用小工具，点开即用</text>
		</view>

		<view class="grid">
			<view
				v-for="item in tools"
				:key="item.name"
				class="card"
				hover-class="card-hover"
				:hover-stay-time="80"
				@click="openTool(item)"
			>
				<view class="card-icon" :style="{ background: item.color }">
					<text class="card-icon-text">{{ item.icon }}</text>
				</view>
				<text class="card-name">{{ item.name }}</text>
				<text class="card-desc">{{ item.desc }}</text>
			</view>
		</view>
	</view>
</template>

<script>
	export default {
		data() {
			return {
				tools: [
					{ name: '二维码', desc: '文本生成二维码', icon: '▦', color: '#269A99', path: '/pages/qrcode/qrcode' },
					{ name: '计算器', desc: '日常四则运算', icon: '=', color: '#5B8FF9', path: '/pages/calculator/calculator' },
					{ name: '幻影坦克', desc: '双图隐藏合成', icon: '◨', color: '#3E4C59', path: '/pages/phantom-tank/phantom-tank' },
					{ name: '光棱坦克', desc: '棋盘格双图隐藏', icon: '▚', color: '#EB2F96', path: '/pages/prism-tank/prism-tank' },
					{ name: '时间戳转换', desc: 'Unix 时间与日期互转', icon: '⏱', color: '#F6BD16', path: '' },
					{ name: 'JSON 格式化', desc: '格式化 / 压缩 / 校验', icon: '{}', color: '#5AD8A6', path: '' },
					{ name: '编码解码', desc: 'Base64 / URL 编码', icon: '⇄', color: '#9270CA', path: '' },
					{ name: '正则测试', desc: '实时匹配与高亮', icon: '.*', color: '#E8684A', path: '' }
				]
			}
		},
		methods: {
			openTool(item) {
				if (item.path) {
					uni.navigateTo({ url: item.path })
					return
				}
				uni.showToast({ title: item.name + ' 开发中', icon: 'none' })
			}
		}
	}
</script>

<style>
	.page {
		min-height: 100vh;
		/* 页面用了自定义导航栏，自己给状态栏留出高度 */
		padding: calc(var(--status-bar-height, 0px) + 32rpx) 24rpx 48rpx;
		box-sizing: border-box;
		background-color: #F5F6FA;
	}

	.header {
		display: flex;
		flex-direction: column;
		padding: 16rpx 8rpx 32rpx;
	}

	.header-title {
		font-size: 48rpx;
		font-weight: bold;
		color: #1F2329;
	}

	.header-desc {
		margin-top: 12rpx;
		font-size: 26rpx;
		color: #8F9299;
	}

	.grid {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		justify-content: space-between;
	}

	.card {
		width: 336rpx;
		margin-bottom: 24rpx;
		padding: 32rpx 28rpx;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		background-color: #FFFFFF;
		border-radius: 20rpx;
		box-shadow: 0 4rpx 16rpx rgba(31, 35, 41, 0.06);
		transition: transform 0.15s ease, box-shadow 0.15s ease;
	}

	.card-hover {
		transform: scale(0.97);
		box-shadow: 0 2rpx 8rpx rgba(31, 35, 41, 0.04);
	}

	.card-icon {
		width: 80rpx;
		height: 80rpx;
		margin-bottom: 24rpx;
		border-radius: 20rpx;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card-icon-text {
		font-size: 36rpx;
		font-weight: bold;
		color: #FFFFFF;
	}

	.card-name {
		font-size: 30rpx;
		font-weight: 500;
		color: #1F2329;
	}

	.card-desc {
		margin-top: 10rpx;
		font-size: 24rpx;
		line-height: 34rpx;
		color: #8F9299;
	}
</style>
