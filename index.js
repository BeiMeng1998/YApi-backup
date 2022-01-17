/**
 * @description 主程序
 */

const fs = require('fs');
const path = require('path');

const _ = require('lodash');
const axios = require('axios');
const program = require('commander');

const config = require('./config');
const log4js = require('./log/config');

axios.defaults.baseURL = config.url;
axios.defaults.headers.Cookie = config.Cookie;

// TODO 支持单个项目的备份与导入
program
    .argument('<actionType>')
    .action(actionType => {
        if (actionType === 'backup') {
            backupGroup();
        }
        if (actionType === 'setup') {
            setup();
        }
    })
    .parse(process.argv);

function backupGroup() {
    axios.get(`/api/project/list?group_id=${config.groupId}`)
    .then(response => {
        const groupList = _.get(response, 'data.data.list', []);
        if (!_.isEmpty(groupList)) {
            const exportList = _.map(groupList, item => ({name: item.name, pid: item._id}));
            log4js.info(`成功获取${exportList.length}个项目！`);
            return exportList;
        } else {
            return Promise.reject('项目列表为空！');
        }
    })
    .then(exportList => {
        const length = exportList.length;
        const lengthObj = {length};
        for (let i = 0; i < length; i++) {
            const project = exportList[i];
            downAndWrite(project, lengthObj);
        }
    })
    .catch(err => {
        log4js.error(err);
    });
}

function downAndWrite(project, lengthObj) {
    const {name, pid} = project;
    log4js.info(`开始下载${name}...`);
    new axios({
        method: 'get',
        url: `/api/plugin/export?type=json&pid=${pid}&status=${config.status}&isWiki=false`,
        responseType: 'stream'
    })
    .then(streamResponse => {
        log4js.info(`${name}下载完成！`);
        log4js.info(`开始备份${name}...`);
        const writer = fs.createWriteStream(path.resolve(__dirname, `apis/${name}-备份.json`));
        writer.on('close', () => {
            log4js.info(`${name}备份完成！`);
            log4js.info(`剩余${--lengthObj.length}个项目...`);
            if (!lengthObj.length) {
                log4js.info(`全部备份完成！`);
            }
        });
        writer.on('error', err => {
            log4js.error(err);
            log4js.info(`${name}备份失败，尝试重新备份...`);
            streamResponse.data.pipe(writer);
        });
        streamResponse.data.pipe(writer);
    })
    .catch(err => {
        log4js.error(err);
        log4js.info(`${name}下载失败，尝试重新下载...`);
        downAndWrite(project, lengthObj);
    });
}

function setup() {
    fs.readdir(path.resolve(__dirname, 'apis'), (err, files) => {
        if (err) {
            log4js.error(err);
            log4js.error('apis文件夹读取失败！');
            return;
        }
        const filesObj = _.map(
            _.filter(files, item => item !== '.gitignore'),
            item => ({
                name: item.replace('.json', ''),
                path: path.resolve(__dirname, `apis/${item}`),
            })
        );
        _.forEach(filesObj, item => {
            const project = {...item};
            const Apidata = require(project.path);
            project.Apidata = Apidata;
            project.paths = _.reduce(Apidata, (prev, curr) => {
                const currPaths = _.map(curr.list, item => ({
                    method: item.method,
                    path: item.path
                }));
                prev = [...prev, ...currPaths];
                return prev;
            }, []);
            project.cats = _.map(Apidata, item => ({
                name: item.name,
                desc: item.desc
            }));
            project.savePaths = [];
            addNewProject(project);
        });
    });
}

function addNewProject(project) {
    const {name} = project;
    log4js.info(`开始新增项目：${name}...`);
    axios.post('/api/project/add', {
        color: 'pink',
        group_id: config.groupId,
        icon: 'code-o',
        name,
        project_type: 'private',
    })
    .then(response => {
        log4js.info(`新增项目${name}成功！`);
        project.projectId = _.get(response, 'data.data._id');
        const payload = {
            apis: project.paths,
            type: 'project',
            typeid: project.projectId
        }
        return payload;
    })
    .then(payload => {
        return axios.post('/api/log/list_by_update', payload);
    })
    .then(() => {
        log4js.info(`开始导入${name}目录...`);
        return addCats(project);
    })
    .then(() => {
        log4js.info(`开始导入${name}接口...`);
        return savePaths(project);
    })
    .catch(err => {
        log4js.error(err);
    });
}

function addCats(project) {
    const {cats, name, projectId} = project;
    let last = cats.length;
    log4js.info(`${name}总目录数：${cats.length}，剩余：${last}`);
    const addCat = (item, index) => {
        return axios.post('/api/interface/add_cat', {...item, project_id: projectId})
        .then(response => {
            const catid = _.get(response, 'data.data._id');
            const catname = _.get(response, 'data.data.name');
            project.savePaths.push(
                ..._.map(project.Apidata[index].list, item => (
                    {
                        ...item,
                        catid,
                        catname,
                        dataSync: 'merge'
                    }
                ))
            );
            log4js.info(`${name}总目录数：${cats.length}，剩余：${--last}`);
            if (!last) {
                log4js.info(`${name}目录已全部导入！`);
            }
        })
        .catch(err => {
            log4js.error(err);
            log4js.info(`${name}目录导入失败，尝试重新导入...`);
            addCat(item, index);
        });
    };
    const promiseArr = _.map(cats, (item, index) => (
        addCat(item, index)
    ));
    return Promise.allSettled(promiseArr);
}

function savePaths(project) {
    const {savePaths, name, projectId} = project;
    let last = savePaths.length;
    log4js.info(`${name}总接口数：${savePaths.length}，剩余：${last}`);
    const savePath = item => {
        return axios.post('/api/interface/save', {...item, project_id: projectId})
        .then(() => {
            log4js.info(`${name}总接口数：${savePaths.length}，剩余：${--last}`);
            if (!last) {
                log4js.info(`${name}接口已全部导入！`);
            }
        })
        .catch(err => {
            log4js.error(err);
            log4js.info(`${name}接口导入失败，尝试重新导入...`);
            savePath(item);
        });
    };
    // 低并发选择
    return new Promise(async (resolve, reject) => {
        for (let i = 0; i < savePaths.length; i++) {
            const item = savePaths[i];
            await savePath(item);
        }
        resolve();
    });
}
