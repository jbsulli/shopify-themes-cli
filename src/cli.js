"use strict";

const chalk = require('chalk');
const exec = require('child_process').exec;
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Shopify = require('./shopify-request.js');
const ShopifyTheme = require('./shopify-theme.js');
const waitingOn = require('waiting-on').waitingOn;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function CLI(args){
    this.git = {};
    this.loadConfig(args);
    
    switch(args[0]){
        case 'init':
            this.initConfig(args.slice(1));
            break;
        case 'up':
            console.log('Not implemented yet...');
            break;
        case 'down':
            this.downloadTheme(args.slice(1));
            break;
        default:
            console.log(chalk.green('Simple CLI for downloading and uploading Shopify themes and keeping track of changes'));
            console.log('');
            console.log(chalk.white('init') + chalk.gray(' - Initialize the Shopify theme settings.'));
            console.log(chalk.white('up <themeid>') + chalk.gray(' - Upload a Shopify theme.'));
            console.log(chalk.white('down <themeid>') + chalk.gray(' - Download a Shopify theme.'));
            process.exit();
    }
}

CLI.prototype.downloadTheme = function(args){
    this.requireInitialized();
    
    this.getTheme(args, err => {
        if(err){
            throw err;
        }
        
        this.theme = new ShopifyTheme(this.theme_id);
        this.theme.download(this.shopify, (err, changed) => {
            if(err){
                throw err;
            }
            
            if(changed && changed.length){
                console.log("Files changed:");
                changed.forEach(file => console.log('- ' + file));
            } else {
                console.log('No files have changed since last sync/download.');
            }
            
            process.exit();
        });
    });
    
    /*this.gitBranch((err, branch) => {
        if(err) throw err;
        
        fs.readFile('.shopify-theme/' + (branch ? branch : '') + '.theme', 'utf8', (err, data) => {
            if(err && err.code !== 'ENOENT'){
                throw err;
            }
            
            var theme_id = args[0];
            
            var theme = new ShopifyTheme();
            theme.download();
        });
    });*/
};

CLI.prototype.getTheme = function(args, callback){
    if(this.theme_id){
        return callback(this.theme_id);
    }
    
    var wait = waitingOn();
    
    if(args[0]){
        this.theme_id = args[0];
    } else {
        this.gitBranch(wait.event('git branch', (err, branch) => {
            if(err){
                return wait.error(err);
            }
            
            if(!this.theme_id){
                this.promptThemeId(args, wait.event('theme id'));
            }
        }));
    }
    
    wait.finally(errors => {
        if(errors){
            return callback(errors[0]);
        }
        
        callback(null, this.theme_id);
    });
};

CLI.prototype.gitBranch = function(callback){
    exec('git rev-parse --abbrev-ref HEAD', { encoding:'utf8' }, (err, data) => {
        if(err){
            if(err.message){
                if(~err.message.indexOf('Not a git repository')){
                    console.log(chalk.yellow('warning:') + chalk.gray(' directory not a git repository.'));
                    return callback();
                }
                else if(~err.message.indexOf('is not recognized as an internal or external command')){
                    console.log(chalk.yellow('warning:') + chalk.gray(' git not found.'));
                    return callback();
                }
                else if(~err.message.indexOf('unknown revision or path')){
                    console.log(chalk.yellow('warning:') + chalk.gray(' could not determine git branch.'));
                    return callback();
                }
            }
            callback(err);
        } else {
            this.git.branch = data.replace(/[\r\n \t]+/g, '');
            
            if(this.config.branches && this.config.branches[this.git.branch]){
                this.theme_id = this.config.branches[this.git.branch];
            }
            
            callback(null, this.git.branch);
        }
    });
};

CLI.prototype.initConfig = function(args){
    var steps = ['shop', 'api_key', 'api_pass'];
    var step;
    
    while(steps.length){
        step = steps.shift();
        
        if(!(step in this.config)){
            switch(step){
                case 'shop': this.promptShop(args, () => this.initConfig()); break;
                case 'api_key': this.promptAPIKey(args, () => this.initConfig()); break;
                case 'api_pass': this.promptAPIPass(args, () => this.initConfig()); break;
            }
            return;
        }
    }
    
    this.shopify = new Shopify(this.config.shop, this.config.api_key, this.config.api_pass, 1, 0.5);
    
    ShopifyTheme.getThemes(this.shopify, (err, data) => {
        if(err){
            throw err;
        }
        
        try {
            fs.mkdirSync(path.join(process.cwd(), '.shopify-theme'));
        } catch(err){
            if(err.code !== 'EEXIST'){
                throw err;
            }
        }
        
        fs.writeFileSync(path.join(process.cwd(), '.shopify-theme', 'config.json'), JSON.stringify(this.config, null, 2), 'utf8');
        console.log('Config saved.');
        process.exit();
    });
};

CLI.prototype.loadConfig = function(args){
    this.initialized = false;
    var file;
    
    try {
        file = fs.readFileSync(path.join(process.cwd(), '.shopify-theme', 'config.json'), 'utf8');
    } catch(err){
        if(err.code === 'ENOENT'){
            this.config = {};
            return;
        } else {
            throw err;
        }
    }
        
    try {
        this.config = JSON.parse(file);
    } catch(err){
        console.error(chalk.red('Could not parse config!'));
        console.error(err);
        return;
    }
    
    this.shopify = new Shopify(this.config.shop, this.config.api_key, this.config.api_pass, 40, 0.5);
        
    this.initialized = true;
};

CLI.prototype.printAPIInstructions = function(){
    console.log(chalk.white('To create API credentials:'));
    console.log(chalk.gray('  1) Log into your store.'));
    console.log(chalk.gray('  2) Go to Apps > View Private Apps > Generate API credentials.'));
    console.log(chalk.gray('  3) Enter a name for the credentials (ex: Theme sync).'));
    console.log(chalk.gray('  4) For permissions, set "theme templates and theme assets" to "read and write".'));
    console.log(chalk.gray('  5) Hit the save button.'));
    console.log(chalk.gray('Shopify should then generate API credentials for you and display your key, password, and secret.'));
};

CLI.prototype.promptAPIKey = function(args, callback, attempt){
    rl.question('What API key do you want to use? ', key => {
        if(!/^[a-z0-9]+/.test(key)){
            console.log(chalk.red('Invalid API key.'));
            this.printAPIInstructions();
            return this.promptAPIKey(args, callback, (attempt ? attempt + 1 : 1));
        }
        
        this.config.api_key = key;
        callback(this.config.api_key);
    });
};

CLI.prototype.promptAPIPass = function(args, callback, attempt){
    rl.question('What API password do you want to use? ', password => {
        if(!/^[a-z0-9]+/.test(password)){
            console.log(chalk.red('Invalid API password.'));
            this.printAPIInstructions();
            return this.promptAPIKey(args, callback, (attempt ? attempt + 1 : 1));
        }
        
        this.config.api_pass = password;
        callback(this.config.api_pass);
    });
};

CLI.prototype.promptAssociateThemeWithBranch = function(callback){
    rl.question('Associate this theme id with the git branch [' + this.git.branch + ']? (yes) ', response => {
        response = response.toLowerCase().trim();
        
        if(!response || response === 'y' || response === 'yes'){
            if(!this.config.branches){
                this.config.branches = {};
            }
            this.config.branches[this.git.branch] = this.theme_id;
            this.saveConfig();
        }
        else if(response === 'n' || response === 'no'){
            callback(this.git.branch);
        }
        else {
            console.log(chalk.red('Unknown response: ' + response));
            this.promptAssociateThemeWithBranch(callback);
        }
    });
};

CLI.prototype.promptShop = function(args, callback, attempt){
    rl.question('What is your myshopify shop url? ', url => {
        var match = url.match(/^([a-zA-Z0-9\-_]+)\.myshopify\.com/);
        
        if(!match){
            console.log(chalk.red('URL must be valid and must end with ".myshopify.com"'));
            return this.promptShop(args, callback, (attempt ? attempt + 1 : 1));
        }
        
        this.config.shop = match[1];
        callback(this.config.shop);
    });
};

CLI.prototype.promptThemeId = function(args, callback, attempt){
    rl.question('What theme would you like to download? ', theme => {
        if(!/^[0-9]+/.test(theme)){
            console.log(chalk.red('Theme must be a valid theme id.'));
            return this.promptThemeId(args, callback, (attempt ? attempt + 1 : 1));
        }
        
        this.theme_id = parseInt(theme);
        
        if(!this.git.branch){
            return callback(this.theme_id);
        }
        
        this.promptAssociateThemeWithBranch(callback);
    });
};

CLI.prototype.requireInitialized = function(){
    if(!this.initialized){
        throw new Error(chalk.red('Could not load Shopify theme config. Please run `shopify-theme init`.'));
    }
};


module.exports = args => new CLI(args);