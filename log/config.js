/**
 * @description 日志配置文件
 */

const log4js = require('log4js');
const path = require('path');

log4js.configure({
    appenders: {
        operation: {type: 'file', filename: path.resolve(__dirname, 'operation.log')},
        stdout: {type: 'stdout', layout: {type: 'pattern', pattern: '%d [%p] [%c] - %m%n'}},
        error: {type: 'file', filename: path.resolve(__dirname, 'error.log')}
    },
    categories: {
        default: {appenders: ['operation', 'stdout'], level: 'info'},
        error: {appenders: ['error'], level: 'error'}
    },
});

const infoLogger = log4js.getLogger(); 
const errorLogger = log4js.getLogger('error');

const loggerProxy = {};
const levels = log4js.levels.levels;
levels.forEach(level => {
    const curLevel = level.levelStr.toLowerCase();
    loggerProxy[curLevel] = (...params) => {
        infoLogger[curLevel](...params);
        errorLogger[curLevel](...params);
    };
});

module.exports = loggerProxy;
