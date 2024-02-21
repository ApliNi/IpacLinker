
```js
   ______                                                           __
  /\__  _\                      IpacLinker                         /\ \
  \/_/\ \/   _____     ____     ____   ____    ____ ___     ____   \_\ \
    \ \ \   /\  __ \  / __ \   / ___\ / __ \  /  __  __ \  / __ \  / __ \
     \_\ \__\ \ \/\ \/\ \/\ \_/\ \__//\ \/\ \_/\ \/\ \/\ \/\ \/\ \/\ \/\ \
     /\_____\\ \  __/\ \__/ \_\ \____\ \__/ \_\ \_\ \_\ \_\ \____/\ \_____\
     \/_____/ \ \ \/  \/__/\/_/\/____/\/__/\/_/\/_/\/_/\/_/\/___/  \/____ /
               \ \_\
                \/_/
```

**IpacLinker**
是一款点对点网络连接工具, 基于 [WebRTC](https://en.wikipedia.org/wiki/WebRTC).
可用于 Minecraft 联机和开服, 或者远程桌面 / 网络驱动器等应用的连接

- 对于服务器, IpacLinker 支持代理协议 v2 (Proxy Protocol v2) 和可选择的本地候选地址对.
并且提供简单的方式支持自建 Signal 服务器

- 对于客户端, IpacLinker 拥有简单易用的配置, 并支持同时连接到多个节点

> 注意! 此软件正在开发中, 可能存在一些错误


## 使用方法

> IpacLinker 的单个进程可以同时启动多个服务端和客户端节点,
以及额外的一个 Signal 服务器
每个节点都有自己唯一的 UUID, 该 UUID 将被用于与其他节点的连接.
对于客户端, 应尽量使用自动生成的随机 UUID.


<!-- <details><summary>安装和运行 [客户端]</summary> -->

### 安装和运行 [客户端]

1. 在 [`Releases`](https://github.com/ApliNi/IpacLinker/releases) 页面下载 `IpacLinker.7z` 并解压
	> 对于 Linux, 需要安装 [Node.js](https://nodejs.org/),
	> 下载 IpacLinker 的源代码并运行 `npm install` 安装依赖

2. 编辑配置文件 `config.js`, 修改客户端配置列表中的 `server` 选项为服务端 UUID
	> 如果保持默认配置, 将连接到 [Ipacamod](https://ipacel.cc/)
	> 只读模式的 Minecraft 测试服务器 (位于中国湖南, 使用移动网络).
	> 这个服务器拥有 64 视距支持和复杂的建筑, 可用于测试稳定性和速度

3. 运行目录下的 `启动.bat`, 或使用命令 `node ./index.js`

当出现绿色的 `使用此地址访问服务器: 127.0.0.1:xxxx` 文本时表示连接成功, 可以通过此地址访问服务器

<!-- </details> -->

---

<!-- <details><summary>安装和运行 [服务端]</summary> -->

### 安装和运行 [服务端]

1. 在 [Releases](https://github.com/ApliNi/IpacLinker/releases) 页面下载 `IpacLinker.7z` 并解压
	> 对于 Linux, 需要安装 [Node.js](https://nodejs.org/),
	> 下载 IpacLinker 的源代码并运行 `npm install` 安装依赖

2. 编辑配置文件 `config.js`, 关闭配置中的 `client.enable`, 并开启 `server.enable`,
	然后修改服务器配置列表中的 `port` 为本地服务器端口

2. 运行目录下的 `启动.bat`, 或使用命令 `node ./index.js`


### 自建 Signal 服务器

开启 `signal.enable` 并修改 `SignalServer` 为 `http://127.0.0.1:61477`.
同时需要更新客户端的 `SignalServer` 配置, 并且使用外网可访问的地址

### 使用代理协议 v2

代理协议 `Proxy Protocol` 可用于向服务器发送代理得到的用户 IP 地址,
与 FRP 中的 `proxy_protocol_version = v2` 效果一致.
此示例用于在 Minecraft 服务器中支持代理协议以获取玩家 IP 地址

1. 在 Minecraft 服务器中安装 [haproxy-detector](https://github.com/andylizi/haproxy-detector) 插件

2. 开启 IpacLinker 配置中对应服务器的 `proxy_protocol_v2`


<!-- </details> -->


---


## 配置
在 [`./config.js`](https://github.com/ApliNi/IpacLinker/blob/master/config.js) 中查看完整配置
```js
// 示例配置
export const Config = {
	client: {			// 客户端配置
		enable: true,	// 启动客户端
		list: [			// 连接列表
			{
				server: 'BE4jTlZT4v27s0eb75uvm1',	// [必选] 连接到哪一个服务器 UUID
				port: 25567,		// [必选] 开放本地端口
				uuid: '',			// [可选] 设置固定的客户端 UUID
				name: 'Minecraft',	// [可选] 设置这个连接的名称
			},
		],
	},
	server: {			// 服务端配置
		enable: false,	// 启动服务端
		list: [			// 连接列表
			{
				uuid: 'BE4jTlZT4v27s0eb75uvm1',	// [可选] 设置固定的服务器 UUID
				port: 25565,		// [必选] 连接到一个本地端口
				name: 'Minecraft',	// [可选] 设置这个连接的名称
				msg: '',			// [可选] 这个服务器的描述信息
				proxy_protocol_v2: false,	// [可选] 使用代理协议 v2 连接到服务器
			},
		],
	},
	// .... 省略其他配置项
};
```

## 致谢

本项目使用了 [p2p-port-mapping](https://github.com/yuanzhanghu/p2p-port-mapping) 的代码, 特别感谢原作者对开源社区的贡献.
