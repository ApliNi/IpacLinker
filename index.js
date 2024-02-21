
import MappingServer from './src/mappingServer.js';
import MappingClient from './src/mappingClient.js';
import { Logger } from './src/logger.js';
import { Config } from './config.js';
import { getUUID, sleep } from './src/util.js';

// 防止运行过程中配置文件更新
export const config = Config;

let index = 0;
const mainLogger = new Logger();


const on = async () => {

	if(config.signal.enable){
		mainLogger.mark('启动 Signal 服务器...');
		await import('./src/signalServer.js');
		await sleep(100);
	}

	if(config.server.enable){
		mainLogger.mark('IpacLinker 将以 "服务端" 模式启动');

		config.server.list.forEach(async (li) => {
			const logger = new Logger();
			logger.prefix = `[${li.name || ` #${++index} `}] `;

			// 检查配置
			if(!li.uuid){
				li.uuid = getUUID();
				logger.warn(`正在使用随机的服务端 UUID, 修改配置以使其固定`);
			}
			if(!li.msg){li.msg = '您正在通过 IpacLinker P2P 连接访问服务器!';}

			// 启动服务端
			logger.info(`服务端节点将连接到本地端口 ${li.port} 并带有 UUID: ${li.uuid}`);
			try{
				new MappingServer(li, logger);
			}catch(err){
				throw new Error('服务端运行时出错');
			}
		});
	}
	
	if(config.client.enable){
		mainLogger.mark('IpacLinker 将以 "客户端" 模式启动');

		config.client.list.forEach(async (li) => {
			const logger = new Logger();
			logger.prefix = `[${li.name || ` #${++index} `}] `;

			// 检查配置
			if(!li.uuid){li.uuid = getUUID();}
			if(!li.server){
				logger.error(`未设定服务器 UUID, 在配置:\n  - ${JSON.stringify(li)}`);
				process.exit();
			}

			logger.info(`客户端将连接到服务器节点: ${li.server.slice(0, 4)}... 并监听本地端口: ${li.port}`);
			const mapClient = new MappingClient(li, logger);
	
			while(true){
				mapClient.client_register();
				// 等待客户端注册完成
				while (!mapClient.isRegistered2SignalServer()) {
					await sleep(1000);
				}
				// 创建对等连接
				mapClient.createPeer();
				for (let i = 0; i < 10; i++) {
					await sleep(3000);
					if (mapClient.isPeerConnected()) {
						logger.debug(`连接已建立! 服务器[${li.server}] -> 客户端[${li.uuid}]`);
						logger.mark(`使用此地址访问服务器: 127.0.0.1:${li.port}`);
						break;
					}
				}
				while (mapClient.isPeerConnected()) {
					await sleep(1000);
				}
				// 断开连接, 重启 Mapping
				await mapClient.close();
				await sleep(4000);
				logger.info(`重新启动 Mapping...`);
			}
		});
	}

	if(!(config.signal.enable || config.server.enable || config.client.enable)){
		const hours = new Date().getHours();
		if(hours >= 9 && hours < 21){
			mainLogger.mark(`吾今日无事可做, 闲庭信步, 静听风吟松涛, 悠然自得.`);
		}else{
			mainLogger.mark(`今日无事挂心, 闲适自得其乐.`);
		}
	}
};
on();
