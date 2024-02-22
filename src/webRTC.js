import EventEmitter from 'events';
import nodeDataChannel from 'node-datachannel';
import { sleep } from './util.js';
const BUFFER_SIZE = 10 * 1024;	 // set buffer size to 0

class WebRTC extends EventEmitter {

	constructor(logger, nodeId, iceServers) {
		super();
		this.logger = logger;
		this.dataChannels = {};
		this.nodeId = nodeId;
		this.defaultChannel = 'DataChannel';
		this.setRemoteDescriptionFlag = false;
		this.messageQueues = {};
		this.sendIntervals = {}; // interval functions for each label
		this.events = {
			PEER_CONNECTED: 'peer_connected',
			PEER_CLOSED: 'peer_closed',
			CHANNEL_CONNECTED: 'channel_connected',
			CHANNEL_CLOSED: 'channel_closed',
			DATA: 'data',
			SIGNAL_DESCRIPTION: 'signal_description',
			SIGNAL_CANDIDATE: 'signal_candidate'
		};
		this.peerConnection = null;
		this.initializePeerConnection(iceServers);
	}

	isDefaultChannel(channelName) {
		return channelName === this.defaultChannel
	}

	createDefaultDataChannel() {
		return this.createDataChannel(this.defaultChannel);
	}
	// The rest of your methods would need to be updated similarly
	// For example:
	createDataChannel(label) {
		if (this.peerConnection) {
			try {
				// this.logger.info(`创建数据通道: ${label}`);
				let dc = this.peerConnection.createDataChannel(label);
				this.setupDataChannelEvents(dc);
				this.dataChannels[label] = { dc, 'opened': false };
				return dc;
			} catch (error) {
				this.logger.error(`数据通道建立错误: `, error.message);
			}
		} else {
			this.logger.info(`Peer 连接尚未初始化`);
		}
	}

	closeDataChannel(label) {
		if (this.dataChannels[label]) {
			// this.logger.info(`关闭数据通道: ${label}`);
			try {
				this.dataChannels[label].dc.close(); // Close the data channel
				delete this.dataChannels[label]; // Remove the reference from the dictionary
				this.emit(this.events.CHANNEL_CLOSED, label); // Emit a disconnected event
				if (label in this.messageQueues) {
					delete this.messageQueues[label];
				}
				if (label in this.sendIntervals) {
					// this.logger.info(`关闭通道 sendInterval: ${channel}`);
					clearInterval(this.sendIntervals[label]);
					delete this.sendIntervals[label];
				}
			} catch (error) {
				this.logger.error(`关闭数据通道时出错 Channel[${label}]: ${error}`);
			}
		} else {
			this.logger.debug(`数据通道 Channel[${label}] 不存在或已被关闭`);
		}
	}

	setupDataChannelEvents(dc) {
		dc.onOpen(async () => {
			await sleep(100); // Wait a bit for all events to process
			let label = dc.getLabel();
			this.logger.debug(`数据通道 Channel[${label}] 已打开`);
			this.dataChannels[label]['opened'] = true
			if (label !== this.defaultChannel) {
				this.sendIntervals[label] = setInterval(() => {
					this._tryToSend(label);
				}, 1);
			}
			this.emit(this.events.CHANNEL_CONNECTED, label);
		});

		dc.onMessage((msg, isBinary) => {
			this.emit(this.events.DATA, {
				label: dc.getLabel(),
				data: msg,
				nodeId: this.nodeId
			});
		});

		dc.onClosed(() => {
			const channel = dc.getLabel();
			this.logger.debug(`数据通道 ${channel} 已关闭`);
			if (channel in this.dataChannels) {
				delete this.dataChannels[channel]
			}
			if (channel in this.messageQueues) {
				delete this.messageQueues[channel];
			}
			if (channel in this.sendIntervals) {
				this.logger.debug(`关闭通道 sendIntervals: ${channel}`);
				clearInterval(this.sendIntervals[channel]);
				delete this.sendIntervals[channel];
			}
			this.emit(this.events.CHANNEL_CLOSED, channel);
		});

		dc.onError((error) => {
			this.logger.info(`数据通道错误: ${error}`);
		});
	}

	// 使用节点数据通道初始化 PeerConnection
	initializePeerConnection(iceServers = []) {
		// 如果需要初始化日志记录器
		// nodeDataChannel.initLogger('Info');

		this.logger.debug(`nodeId: ${this.nodeId}, iceServers:${iceServers}, typeof iceServers:${typeof (iceServers)}`);
		this.logger.debug(`节点数据通道: ${JSON.stringify(nodeDataChannel)}`);
		this.peerConnection = new nodeDataChannel.PeerConnection(this.nodeId, { iceServers });

		// Setup peer connection events
		this.peerConnection.onLocalDescription((sdp, type) => {
			this.logger.debug(`本地描述: ${sdp}, ${type}`);
			this.emit(this.events.SIGNAL_DESCRIPTION, { sdp, type });
		});

		this.peerConnection.onLocalCandidate((candidate, mid) => {
			// 本地候选
			this.emit(this.events.SIGNAL_CANDIDATE, { candidate, mid });
		});

		this.peerConnection.onDataChannel((dc) => {
			this.logger.debug('新数据通道: ', dc.getLabel());
			this.dataChannels[dc.getLabel()] = { dc, 'opened': false }
			this.setupDataChannelEvents(dc);
			this.emit(this.DATACHANNEL_CREATED, dc.getLabel());
		});

		this.peerConnection.onStateChange((state) => {
			this.logger.debug(`Peer 连接状态已更改: ${state}`);
			if (state === 'closed') {
				this.emit(this.events.PEER_CLOSED);
			} else if (state === 'connected') {
				this.emit(this.events.PEER_CONNECTED);
			}
		});

	}

	setRemoteDescription({ sdp, type }) {
		if (!this.peerConnection) {
			this.logger.error('Peer 连接尚未初始化');
			return;
		}

		try {
			this.peerConnection.setRemoteDescription(sdp, type);
			this.setRemoteDescriptionFlag = true; // This flag might be used to check if the remote description was set.
		} catch (error) {
			this.logger.error('设置远程描述失败: ', error);
		}
	}

	dataChannelConnected(Channel) {
		if (Channel in this.dataChannels) {
			return this.dataChannels[Channel].opened;
		}
		return false;
	}

	addRemoteCandidate({ candidate, mid }) {
		// ${buf.address} ` + `port:${buf.port} type:${buf.type} tcpType:${buf.tcpType}`)
		if (!this.peerConnection) {
			this.logger.error('Peer 连接尚未初始化');
			return;
		}
		try {
			this.peerConnection.addRemoteCandidate(candidate, mid);
		} catch (error) {
			this.logger.error('无法添加远程 ICE 候选项: ', error);
		}
	}

	sendBuf(buf, label) {
		if (label in this.dataChannels) {
			if (!(label in this.messageQueues)) {
				this.messageQueues[label] = [];
				// this.logger.info(`设置数据通道缓冲区低阈值`);
				this.dataChannels[label].dc.setBufferedAmountLowThreshold(BUFFER_SIZE);
				this.dataChannels[label].dc.onBufferedAmountLow(() => {
					this._tryToSend(label);
				});
			}
			// this.logger.error(`pushed buf`);
			this.messageQueues[label].push(buf);
		} else {
			// TODO: we have issue that data channel close won't close socket server, 
			//			 which leads to contineous sending data from socket server.
			this.logger.debug(`ERROR: 通道 Channel[${label}] 不存在, 在发送数据时`);
		}
	}

	_tryToSend(label) {
		if (!this.messageQueues[label] || !this.dataChannels[label]) {
			// this.logger.error(`_tryToSend error: channel ${label} does not exist!`);
			return;
		}
		if (!this.dataChannels[label].opened) {
			this.logger.error(`_tryToSend: 通道 ${label} 尚未打开`);
			return;
		}
		while (this.messageQueues[label].length > 0 && this.dataChannels[label].dc.bufferedAmount() <= BUFFER_SIZE) {
			const message = this.messageQueues[label].shift();
			if(this.dataChannels[label].opened){
				// this.logger.info(`sendMessageBinary buf`);
				try{
					this.dataChannels[label].dc.sendMessageBinary(message);
				}catch(err){}
			}else{
				this.logger.warn(`_tryToSend: 通道 ${label} 已关闭`);
				return;
			}
		}
	}

	async close() {
		for (const label in this.dataChannels) {
			this.dataChannels[label].dc.close();
			delete this.dataChannels[label];
		}

		if (this.peerConnection) {
			this.peerConnection.close();
			this.peerConnection = null;
		}

		// Optionally, if you want to make sure everything is cleaned up
		await sleep(1000); // Wait a bit for all events to process
		nodeDataChannel.cleanup();
	}
}

export default WebRTC;
