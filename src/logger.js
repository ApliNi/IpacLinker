import { config } from "../index.js";


export class Logger {
	constructor() {

		this.prefix = '';

		this.info = function (...log) {
			console.log('\x1B[0m[' + getTime() + ' INFO]: ' + this.prefix + log.join('') + '\x1B[0m');
		};

		this.mark = function (...log) {
			console.log('\x1B[92m[' + getTime() + ' MARK]: ' + this.prefix + log.join('') + '\x1B[0m');
		};

		this.log = function (...log) {
			console.log(log);
		};

		this.table = function (log) {
			console.table(log);
		};

		this.warn = function (...log) {
			console.log('\x1B[93m[' + getTime() + ' WARN]: ' + this.prefix + log.join('') + '\x1B[0m');
		};

		this.error = function (...log) {
			console.log('\x1B[91m[' + getTime() + ' ERROR]: ' + this.prefix + log.join('') + '\x1B[0m');
		};

		this.debug = function (...log) {
			if(config.debug){
				this.info(log);
			}
		}
	}
};


function getTime(){
	let time = new Date();
	return	time.getHours().toString().padStart(2, '0')
			+':'+
			time.getMinutes().toString().padStart(2, '0')
			+':'+
			time.getSeconds().toString().padStart(2, '0')
	;
};



new Logger().mark(String.raw`

   ______                                                           __
  /\__  _\                      IpacLinker                         /\ \
  \/_/\ \/   _____     ____     ____   ____    ____ ___     ____   \_\ \
    \ \ \   /\  __ \  / __ \   / ___\ / __ \  /  __  __ \  / __ \  / __ \
     \_\ \__\ \ \/\ \/\ \/\ \_/\ \__//\ \/\ \_/\ \/\ \/\ \/\ \/\ \/\ \/\ \
     /\_____\\ \  __/\ \__/ \_\ \____\ \__/ \_\ \_\ \_\ \_\ \____/\ \_____\
     \/_____/ \ \ \/  \/__/\/_/\/____/\/__/\/_/\/_/\/_/\/_/\/___/  \/____ /
               \ \_\
                \/_/
`);
