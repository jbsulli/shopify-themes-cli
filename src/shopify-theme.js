"use strict";

module.exports = ShopifyTheme;

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const wait = require('waiting-on').waitingOn;

const IS_HASH = /^([0-9]{4}-(?:01|02|03|04|05|06|07|08|09|10|11|12)-[0-3][0-9]T[0-2][0-9]:[0-6][0-9]:[0-6][0-9](?:\.[0-9]{1,3})?Z) ((?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?) (.+)$/;

function ShopifyTheme(theme_id){
    this.theme_id = theme_id;
    this.hashes = {};
    this.last_updated = {};
    this.theme_cache = path.join(process.cwd(), '.shopify-theme', theme_id + '.theme');
    
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

ShopifyTheme.prototype.download = function(shopify, callback){
    shopify.get('themes/' + this.theme_id + '/assets', (err, data, response) => {
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
                this.downloadFile(shopify, asset, waitFor.callback((err, was_changed) => {
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

ShopifyTheme.prototype.downloadFile = function(shopify, asset, callback){
    shopify.get('themes/' + asset.theme_id + '/assets', { asset: { key: asset.key }, theme_id: asset.theme_id }, (err, data, response) => {
        if(err){
            return callback(err);
        }
        
        if(!data || !data.asset){
            return callback(new Error('Could not parse asset.'));
        }
        
        this.saveFile(data.asset, callback);
    });
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

ShopifyTheme.prototype.saveFile = function(data, callback){
    var buff = (data.attachment ? new Buffer(data.attachment, 'base64') : new Buffer(data.value, 'utf8'));
        
    fs.writeFile(path.join(process.cwd(), data.key), buff, err => {
        if(err){
            if(err.code === 'ENOENT'){
                fs.mkdir(path.dirname(data.key), err => {
                    if(err){
                        return callback(err);
                    }
                    this.saveFile(data, callback);
                });
                return;
            }
            
            return callback(err);
        }
        
        var file_hash = crypto.createHash('sha256').update(buff).digest('base64');
        var changed = false;
        if(!this.hashes[data.key] || this.hashes[data.key] !== file_hash){
            changed = true;
            this.hashes[data.key] = file_hash;
        }
        this.last_updated[data.key] = new Date(data.updated_at).getTime();
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

ShopifyTheme.getThemes = function(shopify, callback){
    shopify.get('themes', (err, data, response) => {
        callback(err, (data && data.themes ? data.themes : undefined), response);
    });
};