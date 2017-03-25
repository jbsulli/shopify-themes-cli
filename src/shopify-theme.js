"use strict";

module.exports = ShopifyTheme;

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const wait = require('waiting-on').waitingOn;
const glob = require('glob');
const waitingOn = require('waiting-on').waitingOn;

const IS_HASH = /^([0-9]{4}-(?:01|02|03|04|05|06|07|08|09|10|11|12)-[0-3][0-9]T[0-2][0-9]:[0-6][0-9]:[0-6][0-9](?:\.[0-9]{1,3})?Z) ((?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?) (.+)$/;

const folders = ['assets', 'config', 'dist', 'layout', 'locales', 'sections', 'snippets', 'templates'];

function ShopifyTheme(theme_id, shopify){
    this.theme_id = theme_id;
    this.hashes = {};
    this.last_updated = {};
    this.theme_cache = path.join(process.cwd(), '.shopify-theme', theme_id + '.theme');
    this.shopify = shopify;
    
    var data = '';
    try {
        data = fs.readFileSync(this.theme_cache, 'utf8');
    } catch(err){
        if(err.code !== 'ENOENT'){
            throw err;
        }
    }
    
    data.split(/(?:\r\n|\r|\n)/g).forEach(line => {
        if(!line){
            return;
        }
        
        var match;
        
        if(!(match = line.match(IS_HASH))){
            throw new Error('Invalid theme cache');
        }
        
        this.hashes[match[3]] = match[2];
        this.last_updated[match[3]] = (new Date(match[1])).getTime();
    });
}

ShopifyTheme.prototype.download = function(callback){
    this.shopify.get('themes/' + this.theme_id + '/assets', (err, data, response) => {
        if(err){
            return callback(err);
        }
        
        if(!data.assets || !Array.isArray(data.assets)){
            return callback(new Error('Could parse Shopify assets response.'));
        }
        
        var waitFor = wait();
        var changed = [];
        var count = 0;
        var downloaded = 0;
        
        data.assets.forEach(asset => {
            if(!this.fileMatch(asset.key, asset.updated_at)){
                count++;
                this.downloadFile(asset, waitFor.callback((err, was_changed) => {
                    downloaded++;
                    if(err){
                        return waitFor.error(err);
                    }
                    if(was_changed){
                        console.log('(' + downloaded + ' of ' + count + ') ' + asset.key);
                        changed.push(asset.key);
                    }
                }));
            }
        });
        
        waitFor.finally(errors => {
            if(errors){
                return callback(errors[0]);
            }
            
            this.saveThemeCache(err => {
                if(err){
                    return callback(err);
                }
                callback(null, changed);
            });
        });
    });
};

ShopifyTheme.prototype.downloadFile = function(asset, callback){
    this.shopify.get('themes/' + asset.theme_id + '/assets', { asset: { key: asset.key }, theme_id: asset.theme_id }, (err, data, response) => {
        if(err){
            return callback(err);
        }
        
        if(!data || !data.asset){
            return callback(new Error('Could not parse asset.'));
        }
        
        data = data.asset;
        
        var buff = (data.attachment ? new Buffer(data.attachment, 'base64') : new Buffer(data.value, 'utf8'));
        var hash = this.fileHash(buff);
        
        if(!this.hashes[data.key] || this.hashes[data.key] !== hash){
            this.saveFile(data, buff, callback);
        } else {
            this.last_updated[data.key] = (new Date(data.updated_at)).getTime();
            callback(null, false);
        }
    });
};

ShopifyTheme.prototype.fileHash = function(buff){
    return crypto.createHash('sha256').update(buff).digest('base64');
};

ShopifyTheme.prototype.fileMatch = function(key, updated, hash){
    if(!(key in this.hashes) || !(key in this.last_updated)){
        return false;
    }
    if(updated !== undefined && updated !== null && (new Date(updated)).getTime() !== this.last_updated[key]){
        return false;
    }
    if(hash !== undefined && hash !== null){
        throw new Error("TODO");
    }
    
    return true;
};

ShopifyTheme.prototype.saveFile = function(asset, buff, callback, compare_hash){
    fs.writeFile(path.join(process.cwd(), asset.key), buff, err => {
        if(err){
            if(err.code === 'ENOENT'){
                fs.mkdir(path.dirname(asset.key), err => {
                    if(err){
                        return callback(err);
                    }
                    this.saveFile(asset, buff, callback, compare_hash);
                });
                return;
            }
            
            return callback(err);
        }
        
        var file_hash = this.fileHash(buff);
        var changed = false;
        
        if(!this.hashes[asset.key] || this.hashes[asset.key] !== file_hash){
            changed = true;
            this.hashes[asset.key] = file_hash;
        }
        
        this.last_updated[asset.key] = new Date(asset.updated_at).getTime();
        
        callback(err, changed);
    });
};

ShopifyTheme.prototype.saveThemeCache = function(callback){
    var data = '';
    var line;
    
    for(var key in this.hashes){
        line = (new Date(this.last_updated[key])).toISOString() + " " + this.hashes[key] + " " + key;
        data += '\n' + line ;
    }
    
    fs.writeFile(this.theme_cache, data.substr(1), 'utf8', callback);
};

ShopifyTheme.prototype.upload = function(callback){
        
    glob('+(' + folders.join('|') + ')/**/*.*', { nodir:true, dot:true }, (err, files) => {
        if(err){
            return callback(err);
        }
        
        var wait_for = waitingOn.apply(undefined, files);
        var errors = {};
        var uploaded = [];
        var count = 0;
        var done = 0;
        
        if(files && files.length){
            files.forEach(file => {
                wait_for.after(file, () => {
                    if(~uploaded.indexOf(file)){
                        console.log(`(${++done}/${count}) ${file}`);
                    }
                });
                
                fs.readFile(path.join(process.cwd(), file), (err, buff) => {
                    if(err){
                        errors[file] = err;
                        return wait_for.finished(file);
                    }
                    
                    var hash = this.fileHash(buff);
                    
                    if(!(this.hashes[file]) || this.hashes[file] !== hash){
                        count++;
                        this.uploadFile(file, buff, err => {
                            if(err){
                                errors[file] = err;
                            } else {
                                uploaded.push(file);
                                this.hashes[file] = hash;
                            }
                            wait_for.finished(file);
                        });
                    } else {
                        wait_for.finished(file);
                    }
                });
            });    
        }
        
        wait_for.finally(() => {
            if(Object.keys(errors).length){
                return callback(errors);
            }
            this.saveThemeCache(err => {
                if(err){
                    return callback(err);
                }
                callback(null, uploaded);
            });
        });
    });
};

ShopifyTheme.prototype.uploadFile = function(file, buff, callback){
    this.shopify.put(`themes/${this.theme_id}/assets`, undefined, { asset: { key:file, attachment:buff.toString('base64') } }, (err, data) => {
        if(err){
            return callback(err);
        }
        
        if(!data || !data.asset || !data.asset.updated_at || !data.asset.key){
            return callback(new Error('Could not parse asset upload response.'));
        }
        
        this.last_updated[data.asset.key] = (new Date(data.asset.updated_at)).getTime();
        
        callback();
    });
};

ShopifyTheme.getThemes = function(shopify, callback){
    shopify.get('themes', (err, data, response) => {
        callback(err, (data && data.themes ? data.themes : undefined), response);
    });
};