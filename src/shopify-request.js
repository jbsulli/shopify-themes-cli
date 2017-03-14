"use strict";

module.exports = Shopify;

var request = require('request');

function Shopify(shop, key, password, initial_throttle, throttle_rate){
    this.shop = shop;
    this.key = key;
    this.password = password;
    this.throttle = (initial_throttle || 1);
    this.throttled = {
        requests:[],
        rate: (throttle_rate || 0.5), // per second
        out:0
    };
}

Shopify.prototype.get = function(url, query, callback){
    if(typeof query === 'function'){
        callback = query;
        query = undefined;
    }
    this.request('GET', url, query, undefined, callback);
};

Shopify.prototype.request = function(method, url, query, body, callback){
    
    var request_data = {
        out:false,
        attempts: 0,
        method: method.toUpperCase(),
        url: 'https://' + this.shop + '.myshopify.com/admin/' + url + '.json',
        query: query,
        body: body,
        callback: callback
    };
    
    this.throttled.requests.push(request_data);
    
    this.checkThrottled();
};

Shopify.prototype.checkThrottled = function(){
    if(this.throttled.requests.length === 0){
        return;
    }
    
    // currently throttled?
    if(this.throttle === 0){
        // should have a timer...
        if(!this.throttle_timer){
            // create a timer
            this.throttle_timer = setInterval(() => {
                this.throttle++;
                
                this.checkThrottled();
                
                if(this.throttle > 40){
                    this.throttle = 40;
                    clearInterval(this.throttle_timer);
                    this.throttle_timer = null;
                }
            }, this.throttle_rate * 1000);
        }
        return;
    }
    
    var throttled = this.throttled.requests.filter(request => !request.out).splice(0, this.throttle);
    
    throttled.forEach(request => {
        this.send(request);
    });
};

Shopify.prototype.send = function(data){
    this.throttle--;
    this.throttled.out++;
    data.out = true;
    data.attempts++;
    
    var send = {
        method: data.method,
        url: data.url,
        json: true,
        auth: {
            user: this.key,
            pass: this.password
        }
    };
    
    if(data.query){
        send.qs = data.query;
    }
    
    if('body' in data){
        send.body = data.body;
    }
    
    try {
        request(send, (err, response, body) => {
            if(!err && response.statusCode !== 200 && ((body && (body.error || body.errors)) || response.statusMessage)){
                err = new Error((body ? body.error || body.errors : undefined) || response.statusMessage);
                err.statusCode = response.statusCode;
            }
            this.done(data, err, response, body);
        });
    } catch(err){
        this.throttle++;
        this.done(data, err);
    }
};

Shopify.prototype.done = function(request, err, response, body){
    this.throttled.out--;
    
    if(response){
        if(response.headers && response.headers.HTTP_X_SHOPIFY_SHOP_API_CALL_LIMIT){
            try {
                var limit = response.headers.HTTP_X_SHOPIFY_SHOP_API_CALL_LIMIT.split('/');
                if(this.throttle > parseInt(limit[0]) - this.throttled.out){
                    this.throttle = parseInt(limit[0]) - this.throttled.out;
                }
            } catch(err){
                console.error('Bad limit response: ' + response.headers.HTTP_X_SHOPIFY_SHOP_API_CALL_LIMIT);
            }
        }
        
        if(response.statusCode === 429){
            request.out = false;
            if(this.throttle > 0){
                this.throttle = 0;
            }
            this.checkThrottled();
            return;
        }
    }
    
    var i = this.throttled.requests.indexOf(request);
    
    if(~i){
        this.throttled.requests.splice(i, 1);
    }
    
    request.callback(err, body, response);
};