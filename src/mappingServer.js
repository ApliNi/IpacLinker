
import net, { isIPv6 } from 'net';
import SignalClient from './signalClient.js';
import WebRTC from './webRTC.js';
import { config } from '../index.js';

export default class MappingServer {

	constructor(li = {port, uuid, msg, proxy_protocol_v2}, logger){
		this.li = li;
		this.logger = logger;
		this.signalClient = new SignalClient(this.logger);
		this.net = net.createConnection; // If you need it
		this.clientList = {};

		this.signalClient.on('close', async () => {
			logger.info(`Signal 客户端已关闭`);
			
			/* we can add this back in future if we need to close MappingServer when signalClient temporarily closed.
			await this.close();
			this.signalClient = undefined
			*/
		});

		// 连接完成时注册服务器
		this.signalClient.on('connect', () => {
			this.signalClient.server_register({
				version: 0.1,
				server: li.uuid,
			});
		});

		this.signalClient.on('msg', async (msgObj) => {
			let { type, data } = msgObj
			// logger.info(`来自 signalServer 的消息 [${type}]: ${JSON.stringify(data)}`);

			switch(type){
				case 'ServerReg': {
					if(!data.success){
						logger.error(`注册失败: ${data}`);
						return;
					}
					logger.mark(`服务端已注册! 本地端口[${li.port}] -> Server[${li.uuid}]`);
					break;
				}

				case 'errMsg': {
					logger.error(`[SignalServer]: ${JSON.stringify(data)}`);
					break;
				}

				case 'client_registered': {
					logger.info(`客户端注册[${data.ip}]: Client[${data.uuid}]`);
					this.clientList[data.uuid] = {
						ip: data.ip,
						subclientList: {},
						peerAnswer: null,
					};
					break;
				}

				case 'client_unregister': {
					logger.info(`客户端注销[${data.ip}]: Client[${data.uuid}]`);
					if(!this.clientList[data.uuid]){
						return;
					}
					if(this.clientList[data.uuid].peerAnswer !== null){
						return;
					}else{
						delete this.clientList[data.uuid];
					}
					break;
				}

				case 'clientSignal': {
					const { event, uuid, channel, buf } = data;
					logger.debug(`映射服务端: Client[${uuid}].[${channel}], Event[${event}], Buf: ${buf}`);
	
					switch (event) {
						case 'client_signal_description': {
							if(this.clientList[uuid]?.peerAnswer){
								this.clientList[uuid].peerAnswer.setRemoteDescription(buf)
							}else{
								// logger.info(`创建 peerAnswer...`)
								const peerAnswer = new WebRTC(logger, 'server_peer', config.ICEServer);

								peerAnswer.on('channel_closed', async (channel) => {
									logger.info(`通道关闭: Client[${uuid}].[${channel}]`);
									if (this.clientList[uuid] && this.clientList[uuid].subclientList[channel]) {
										logger.info(`关闭到本地服务器的连接: Client[${uuid}].[${channel}]`);
										this.clientList[uuid].subclientList[channel].socket2server.end();
									}
								});

								peerAnswer.on('channel_connected', async (channel) => {
									logger.info(`通道连接: Client[${uuid}].[${channel}]`);
									// is default channel
									if(peerAnswer.isDefaultChannel(channel)){
										this.sendMsg2Client(li.uuid, uuid, li.msg);
										logger.info(`[MSG] -> Client[${uuid}]: ${li.msg}`);
										return;
									}
									logger.info('尝试连接到本地服务器...');
									if(!await this.connect2LocalServer(uuid, channel, li.port)){
										logger.error(`连接本地服务器时出错: Channel[${channel}]`);
									}
								})

								peerAnswer.on('signal_description', signalData => { // server response
									logger.debug(`生成服务端 signal`)
									this.signalClient.server_send_signal({
										event: 'server_signal_description',
										uuid: uuid,
										server: li.uuid,
										buf: signalData,
									})
								})

								peerAnswer.on('error', (err) => {
									logger.error(`映射服务器错误: ${err}`);
								})

								peerAnswer.on('peer_connected', () => {
									logger.info(`客户端已连接: Client[${uuid}]`);
								});

								peerAnswer.on('peer_closed', () => {
									logger.info(`客户端已断开连接: Client[${uuid}]`);
									if (!this.clientList[uuid]) {
										return
									}
									for (let channel in this.clientList[uuid].subclientList) {
										this.clientList[uuid].subclientList[channel].socket2server.end()
									}
									// peerAnswer.close() // already disconnected, do not call close()
									delete this.clientList[uuid]
								});

								peerAnswer.on('signal_candidate', signalData => { // server response
									const data = signalData.candidate.split(' ');
									// 匹配需要排除的地址
									for(const li of config.excludeCandidatePair.list){
										if(li.test(data[4])){
											this.logger.debug(`排除本地候选: ${signalData.candidate} -- ${signalData.mid}`);
											return;
										}
									}
									this.logger.debug(`本地候选: ${signalData.candidate} -- ${signalData.mid}`);
									this.signalClient.server_send_signal({
										event: 'server_signal_candidate',
										uuid: uuid,
										server: li.uuid,
										buf: signalData,
									});
								});

								peerAnswer.on('data', ({ label, data, nodeId }) => {
									let channel = label;
									if (channel in this.clientList[uuid].subclientList) {
										// logger.info(`wrtc -> local server`);
										this.clientList[uuid].subclientList[channel].socket2server.write(data);
									}
								});

								// 现在有单独的客户端注册事件
								this.clientList[uuid].peerAnswer = peerAnswer;

								// we have remotedescription already here.
								this.clientList[uuid].peerAnswer.setRemoteDescription(buf);
							}
							break;
						}
	
						case 'client_signal_candidate': {
							if(!(this.clientList[uuid])){
								break;
							}
							const json = JSON.stringify(buf);
							if(!this.clientList[uuid].ip){
								this.clientList[uuid].ip = json;
							}
							let peerAnswer = this.clientList[uuid].peerAnswer;
							logger.debug(`映射服务器: 添加远程客户端 signal 候选 ${json}`);
							peerAnswer.addRemoteCandidate(buf);
							break;
						}
	
						case 'disconnectRemoteServer': {
							break;
						}
	
						case 'clientMsg': {
							logger.info(`客户端消息 client[${uuid}]: buf: ${buf}`);
							break;
						}
	
						case 'connectRemoteServer': {
							break;
						}
	
						case 'errMsg': {
							logger.error(JSON.stringify(buf));
							break;
						}
	
						default: {
							logger.error(`未知事件: ${event}`);
							break;
						}
					}
					break;
				}
			}
		});
	}

	async connect2LocalServer(uuid, channel, serverPort) {
		return new Promise((resolve) => {
			const socket2server = this.net({port: parseInt(serverPort)}, () => {
				// 代理协议 v2
				if(this.li.proxy_protocol_v2){
					const ip = this.clientList[uuid].ip;
					if(isIPv6(ip)){
						socket2server.write(`PROXY TCP6 ${ip} ::1 1024 1024\r\n`);
					}else{
						socket2server.write(`PROXY TCP4 ${ip} 127.0.0.1 1024 1024\r\n`);
					}
				}
				// 'connect' listener
				if (this.clientList[uuid] && this.clientList[uuid].subclientList) {
					this.clientList[uuid].subclientList[channel].connected2LocalServer = true
				}
				this.logger.info(`连接到本地服务器: Client[${uuid}].[${channel}]`);
				resolve(true)
			});
			socket2server.on('data', async (data) => { // data is a Buffer
				// this.clientList[uuid].subclientList[channel].sendBufList.push(data)
				if (this.clientList[uuid]) {
					this.clientList[uuid].peerAnswer.sendBuf(data, channel)
				}
			});
			socket2server.on('end', () => {
				// this.logger.info(`连接关闭: ${channel}`);
			});
			socket2server.on('close', err => {
				// this.logger.info(`与本地服务器的 Socket 连接已关闭: ${err}`);
				if (this.clientList[uuid] && channel in this.clientList[uuid].subclientList) {
					try {
						this.clientList[uuid].peerAnswer.closeDataChannel(channel)
					} catch (e) {}
					delete this.clientList[uuid].subclientList[channel]
				}
				resolve(false)
			});
			socket2server.on('error', (err) => {
				this.logger.error(`连接到本地服务器时出错: ${err}`)
				if (this.clientList[uuid] && channel in this.clientList[uuid].subclientList) {
					// this.clientList[uuid].peerAnswer.closeDataChannel(channel)
					delete this.clientList[uuid].subclientList[channel]
				}
				resolve(false)
			});
			if (this.clientList[uuid]) {
				this.clientList[uuid].subclientList[channel] = {
					socket2server,
				}
			} else {
				this.logger.error(`uuid ${uuid} 不存在于 this.clientList: ${Object.keys(this.clientList)}`)
			}
		})
	}

	async sendMsg2Client(server, uuid, buf) {
		this.signalClient.server_send_signal({
			event: 'serverMsg',
			uuid: uuid,
			server: server,
			buf: buf,
		})
	}

	async close() {
		for (let uuid in this.clientList) {
			if (!this.clientList[uuid]) {
				break
			}
			if (this.clientList[uuid]) {
				let { peerAnswer, subclientList } = this.clientList[uuid]
				if (peerAnswer) {
					await peerAnswer.close()
				}
				for (let channel in subclientList) {
					let { socket2server } = subclientList[channel]
					if (socket2server) {
						socket2server.end()
					}
				}
			}
		}
		if (this.signalClient) {
			this.signalClient.close()
		}
	}
};
