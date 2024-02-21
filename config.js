
// 注意: 这些配置由 JavaScript 代码实现

// 注意: UUID 代表一个节点的身份 (客户端) 或连接方式 (服务端)
// 对于客户端, 请不要泄露自己的固定 UUID. 若非必要, 应使用自动生成 UUID
// 对于服务端, 应谨慎保管和公布固定 UUID

export const Config = {

	// 客户端配置
	client: {
		// 启动客户端
		enable: true,
		// 连接列表
		list: [
			{
				// [必选] 连接到哪一个服务器 UUID
				server: 'AE4jTlZT4v27s0eb75uvm1',
				// [必选] 开放本地端口
				port: 25567,
				// [可选] 设置固定的客户端 UUID
				uuid: '',
				// [可选] 设置这个连接的名称
				name: 'Minecraft',
			},
		],
	},


	// 服务端配置
	server: {
		// 启动服务端
		enable: false,
		// 连接列表
		list: [
			{
				// [可选] 设置固定的服务器 UUID
				uuid: '',
				// [必选] 连接到一个本地端口
				port: 25565,
				// [可选] 设置这个连接的名称
				name: 'Minecraft',
				// [可选] 这个服务器的描述信息
				msg: '您正在通过 IpacLinker P2P 连接访问服务器!',
				// [可选] 使用代理协议 v2 连接到服务器
				proxy_protocol_v2: false,
			},
		],
	},


	// 哪些地址不应作为本地候选地址对
	excludeCandidatePair: {
		// 地址列表, 正则匹配
		list: [
			/^.+ff:fe.{2}:.+$/,	// 固定后缀的 IPv6 地址
			/^192\.168\..+$/,	// 内网地址
			/^100\..+$/,		// 100. 开头的 IPv4 地址 (一些异地组网软件)
		],
		// 是否仅对服务器有效, false = 同时应用于客户端
		serverOnly: false,
	},


	// Signal 服务器
	// 可以同时启动服务端节点和 Signal 服务器
	signal: {
		// 启动 Signal 服务器
		enable: false,
		// 监听端口
		port: 61477,
	},


	// 其他配置, 一般情况下无需改动
	debug: false,
	SignalServer: 'https://signal.ipacel.cc', // 'http://127.0.0.1:61477',
	ICEServer: [
		'stun:stun.zoiper.com',
		'stun:stun.l.google.com:19302',
		'stun:stun.gmx.net',
		'stun:stun.schlund.de',
		'turn:openrelayproject:openrelayproject@openrelay.metered.ca:80',
		'turn:free:free@freeturn.net:3478',
	],
};
