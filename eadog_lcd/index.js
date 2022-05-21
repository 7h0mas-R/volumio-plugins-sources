'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var font = require('font');
var lcd = require('lcd');
var io = require('socket.io-client');
const fontStyles = require('font').fontStyle
const animationTypes = require('lcd').animationTypes

const states = Object.freeze({
    starting: 0,
    status: 1,
    menu: 3,
    error: 4,
    info: 5,
    critical: 6,
    stopping: 10
})

module.exports = eadogLcd;
function eadogLcd(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;

}




eadogLcd.prototype.onVolumioStart = function()
{
	var self = this;
	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

    return libQ.resolve();
}

eadogLcd.prototype.onStart = function() {
    var self = this;
	var defer=libQ.defer();

    self.debugLogging = (self.config.get('logging')==true);
    self.maxLine = 4;
    if (self.debugLogging) self.logger.info('[EADOG_LCD] onStart: load EA-DOG ');
    if (process.platform != 'darwin'){
    	if (self.debugLogging) self.logger.info('[EADOG_LCD] onStart: generating LCD display on platform ' + process.platform);
        self.display = new lcd.DogS102();
    } else {
    	if (self.debugLogging) self.logger.info('[EADOG_LCD] onStart: generating TTY simulator on platform ' + process.platform);
        self.display = new lcd.TTYSimulator();
    }
    self.font_prop_16px = new font.Font();
    self.font_prop_8px = new font.Font();
	if (self.debugLogging) self.logger.info('[EADOG_LCD] onStart: starting plugin');
    if (process.platform != 'darwin') {
        if (self.debugLogging) self.logger.info('[EADOG_LCD] onStart: connect socket on Volumio, platform ' + process.platform);
        self.socket = io.connect('http://localhost:3000');
    } else {
        if (self.debugLogging) self.logger.info('[EADOG_LCD] onStart: connect socket to Volumio from Mac, platform ' + process.platform);
        self.socket = io.connect('http://volumio:3000');
    }

    //############################### improve, path is not good
    self.font_prop_16px.loadFontFromJSON('font_proportional_16px.json');
    self.font_prop_8px.loadFontFromJSON('font_proportional_8px.json');
    self.font_prop_16px.spacing = 0;
    self.state = 0;
    self.status = {};
    self.activePage = 0;
    self.selectedLine = 0;
    self.currentLevel = self.config.get('startLevel');
    self.display.initialize({pinCd: 25, pinRst: 20, speedHz: 800000, viewDirection: 0, volume: 6})
    .then(_ => self.display.clear())
    .then(_ => self.display.setPageBufferLines(0,"UNDA 3.0",self.font_prop_16px))
    .then(_ => self.display.setPageBufferLines(3,"powered by",self.font_prop_8px,0,animationTypes.swingPage))
    .then(_ => self.display.setPageBufferLines(4,"       Volumio 3",self.font_prop_8px,0,animationTypes.swingPage))
    .then(_ => self.display.setPageBufferLines(7,"(C)2022 7h0mas-R",self.font_prop_8px,0,animationTypes.swingPage))
    .then(_ => self.display.startAnimation(1000))
    .then(_ => {
        let timeout = 1000 * parseInt(self.config.get('splashScreenTimeout'));
        if (self.debugLogging) this.logger.info('[EADOG_LCD] onStart: setting SplashScreenTimer to ' + timeout + ' ms.')
        setTimeout(() => {
            if (self.debugLogging) this.logger.info('[EADOG_LCD] onStart: SplashScreenTimer elapsed')
            self.display.clear()
            .then(_=>self.activateListeners())
        }, timeout)
    })    

	// Once the Plugin has successfull started resolve the promise
    .then(_ =>  {
        if (self.debugLogging) self.logger.info('[EADOG_LCD] onStart: successfully started plugin');
        defer.resolve();
    })
    // .fail(err => self.logger.error('[EADOG_LCD] onStart: failed with ', err))

    return defer.promise;
};

eadogLcd.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();

    if (self.debugLogging) this.logger.info('[EADOG_LCD] onStop: stopping plugin')
    self.display.stopAnimation();
    self.deactivateListeners();
    self.socket.close();

    // Once the Plugin has successfull stopped resolve the promise
    defer.resolve();

    return libQ.resolve();
};

eadogLcd.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};


// Configuration Methods -----------------------------------------------------------------------------

eadogLcd.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {


            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });

    return defer.promise;
};

eadogLcd.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

eadogLcd.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

eadogLcd.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

eadogLcd.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};

eadogLcd.prototype.activateListeners = function () {
    var self = this;
    if (self.debugLogging) self.logger.info('[EADOG LCD] activateListeners: activating');
    self.socket.on('pushBrowseLibrary', function(data) {
        if (data.navigation != undefined && data.navigation.prev != undefined) {
            self.previousLevel = data.navigation.prev.uri;
        } else {
            self.previousLevel = "/";
        }
        if (data.hasOwnProperty('navigation') && data.navigation.hasOwnProperty('lists') && data.navigation.lists.length > 0) {
            self.menuItems = data.navigation.lists[0].items;
            self.pageCount = Math.ceil(self.menuItems.length/self.maxLine);
            self.activePage = 0;
            self.selectedLine = 0;
            self.refreshDisplay(self.menuItems);
        }
    });
    self.socket.on('pushBrowseSources', function(data) {    
        self.menuItems = data;
        self.pageCount = Math.ceil(data.length/self.maxLine);
        self.activePage = 0;
        self.selectedLine = 0;
        self.refreshDisplay(self.menuItems);
    });
    self.socket.on('pushState', function(state) {
        if (self.debugLogging) self.logger.info('[EADOG LCD] Push: ' + state.status + " - " + state.artist +  " - " + state.title);
        self.updateStatus(state);
    });
    let startUri = self.config.get('startLevel');
    if (startUri != undefined && startUri!="/") {
        self.socket.emit('browseLibrary',{"uri":startUri});    
    } else {
        self.socket.emit('getBrowseSources');
    }
    self.socket.emit('getState');
    // self.socket.emit('browseLibrary',{"uri":"radio/selection"});
}

eadogLcd.prototype.deactivateListeners = function () {
    var self = this;
    self.socket.off();
    // self.socket.off('pushBrowseSources');
    // self.socket.off('pushState');
    // self.socket.emit('browseLibrary',{"uri":"radio/selection"});
}

eadogLcd.prototype.up = function(){
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] up: Received up command in status:' + self.state)
    switch (self.state) {
        case states.menu:
            if (self.menuItems != undefined) {
                self.selectedItem = (self.activePage * self.maxLine + self.selectedLine)
                self.selectedItem = (self.selectedItem + self.menuItems.length - 1) % self.menuItems.length;
                self.activePage = Math.floor(self.selectedItem/self.maxLine);
                self.selectedLine = self.selectedItem % self.maxLine;
                self.refreshDisplay(self.menuItems)
            }            
            break;
    
        default:
            self.state = states.menu;
            self.status = {};
            self.refreshDisplay(self.menuItems)
            break;
    }
    self.resetMenuTimer();
}

eadogLcd.prototype.down = function(){
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] down: Received down command in status:' + self.state)
    switch (self.state) {
        case states.menu:
            if (self.menuItems != undefined) {
                self.selectedItem = (self.activePage * self.maxLine + self.selectedLine)
                self.selectedItem = (self.selectedItem + 1) % self.menuItems.length;
                self.activePage = Math.floor(self.selectedItem/self.maxLine);
                self.selectedLine = self.selectedItem % self.maxLine;
                self.refreshDisplay(self.menuItems)
            }
            break;
    
        default:
            self.state = states.menu;
            self.status = {};
            self.refreshDisplay(self.menuItems)
            break;
    }
    self.resetMenuTimer();
}

 eadogLcd.prototype.select = function(){
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] select: Received select command in status:' + self.state)
    switch (self.state) {
        case states.menu:
            let selectedItem = (self.activePage * self.maxLine + self.selectedLine)
            let selectedType = self.menuItems[selectedItem].plugin_type != undefined? self.menuItems[selectedItem].plugin_type: self.menuItems[selectedItem].type
            switch (selectedType) {
                case 'music_service':
                case 'radio-category':
                case 'radio-favourites':
                case 'folder':
                    self.currentLevel = self.menuItems[selectedItem].uri
                    self.socket.emit('browseLibrary',{"uri":self.currentLevel})
                    break;
                case 'webradio':
                    self.socket.emit('replaceAndPlay',self.menuItems[selectedItem])
                case 'song':
                case 'playlist':
                    self.socket.emit('addPlay',self.menuItems[selectedItem])
                    break;
                default:
                    break;
            }
            break;
    
        default:
            self.state = states.menu;
            self.status = {};
            self.refreshDisplay(self.menuItems)
            break;
    }
    self.resetMenuTimer();
}

 eadogLcd.prototype.addToQueueAndPlay = function(){
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] addToQueueAndPlay: Received command in status:' + self.state)
    switch (self.state) {
        case states.menu:
            let selectedItem = (self.activePage * self.maxLine + self.selectedLine)
            let selectedType = self.menuItems[selectedItem].plugin_type != undefined? self.menuItems[selectedItem].plugin_type: self.menuItems[selectedItem].type
            switch (selectedType) {
                case 'music_service':
                case 'radio-category':
                case 'folder':
                case 'song':
                case 'playlist':
                    self.socket.emit('addToQueue',{"uri":self.menuItems[selectedItem].uri});
                    self.socket.emit('play')
                    break;
                case 'webradio':
                    break;
                default:
                    break;
            }
            break;
    
        default:
            self.state = states.menu;
            self.status = {};
            self.refreshDisplay(self.menuItems)
            break;
    }
    self.resetMenuTimer();
}

 eadogLcd.prototype.replaceQueueAndPlay = function(){
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] replaceQueueAndPlay: Received command in status:' + self.state)
    switch (self.state) {
        case states.menu:
            let selectedItem = (self.activePage * self.maxLine + self.selectedLine)
            let selectedType = self.menuItems[selectedItem].plugin_type != undefined? self.menuItems[selectedItem].plugin_type: self.menuItems[selectedItem].type
            switch (selectedType) {
                case 'music_service':
                case 'radio-category':
                case 'folder':
                case 'song':
                case 'playlist':
                    self.socket.emit('clearQueue');
                    self.socket.emit('addToQueue',{"uri":self.menuItems[selectedItem].uri});
                    setTimeout(() => {
                        self.socket.emit('play');
                    }, 150); 
                    break;
                case 'webradio':
                    break;
                default:
                    break;
            }
            break;
    
        default:
            self.state = states.menu;
            self.status = {};
            self.refreshDisplay(self.menuItems)
            break;
    }
    self.resetMenuTimer();
}
 eadogLcd.prototype.back = function(){
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] back: Received command in status:' + self.state)
    switch (self.state) {
        case states.menu:
            if (self.previousLevel != undefined) {
                if (self.currentLevel != self.config.get('highestLevel')) {
                    if (self.previousLevel == "/") {
                        self.currentLevel = "/";
                        self.socket.emit('getBrowseSources');
                    } else {
                        self.currentLevel = self.previousLevel;
                        self.socket.emit('browseLibrary',{"uri":self.currentLevel})
                    }
                }
            }
            break;
    
        default:
            self.state = states.menu;
            self.status = {};
            self.refreshDisplay(self.menuItems)
            break;
    }
    self.resetMenuTimer();
}

eadogLcd.prototype.resetMenuTimer = function () {
    var self = this;
    if (self.menuTimer == undefined) {
        self.menuTimeout = self.config.get('menuTimeout')*1000;
        if (self.debugLogging) this.logger.info('[EADOG_LCD] resetMenuTimer: creating new Timer')
        self.menuTimer = setTimeout(() => {
            if (self.debugLogging) this.logger.info('[EADOG_LCD] resetMenuTimer: menu Timeout elapsed on Timer: ' + self.menuTimer)
            clearTimeout(self.menuTimer);
            self.menuTimer = null;
            self.state = states.status;
            self.refreshDisplay(self.menuItems);
        }, self.menuTimeout);
    } else {
        if (self.debugLogging) this.logger.info('[EADOG_LCD] resetMenuTimer: restarting Timer: ' + self.menuTimer)
        self.menuTimer.refresh();
    }
}
eadogLcd.prototype.updateStatus = function (status){
    var self = this;
    if (status != undefined) {
        if (self.debugLogging) this.logger.info('[EADOG_LCD] updateStatus: ' + JSON.stringify(status));
        if (status.artist !=undefined && (self.status.artist == undefined || status.artist != self.status.artist) ) {
            self.display.setPageBufferLines(0,status.artist || '',self.font_prop_16px,fontStyles.normal,animationTypes.rotatePage,undefined,' +++ ');
        }
        if (status.title!=undefined && (self.status.title == undefined || status.title != self.status.title) ) {
            self.display.setPageBufferLines(2,status.title,self.font_prop_16px,fontStyles.normal,animationTypes.rotatePage,undefined,' +++ ');
        }
        self.display.setPageBufferLines(4," ",self.font_prop_16px,fontStyles.normal,animationTypes.none);
        if (status.status!=undefined && (self.status.status == undefined || status.status != self.status.status)) {
            self.display.setPageBufferLines(6,status.status,self.font_prop_16px,fontStyles.normal,animationTypes.none);
        }
        self.status = status;
    } 
}

eadogLcd.prototype.refreshDisplay = async function (){
    var self = this;
    switch (self.state) {
        case states.menu:
            let pagesPerLine = self.font_prop_16px._heightBytes;
            var style = 0;
            if (self.menuItems!=undefined) {
                for (let i = 0; i < self.maxLine; i++) {
                    if (i==self.selectedLine) {
                        style = fontStyles.inverted; //inverted
                    } else {
                        style = fontStyles.normal;  //normal
                    }
                    let item = i+ self.activePage * self.maxLine;
                    let outputLine = "                   ";
                    if (item < self.menuItems.length) { 
                        switch (self.menuItems[item].type) {
                            case 'radio-category':
                            case 'mywebradio-category':
                            case 'radio-favourites':
                            case 'folder':
                            case 'webradio':
                            case 'playlist':
                                outputLine = self.menuItems[item].title+ "  ";                    
                                break;
                            case 'song':
                                outputLine = self.menuItems[item].tracknumber + ") " + self.menuItems[i+ self.activePage * self.maxLine].title + "  ";                    
                                break;
                            default:
                                outputLine = self.menuItems[item].name;
                                break;
                        }
                    }
                    this.display.setPageBufferLines(i* pagesPerLine,outputLine,self.font_prop_16px,style,animationTypes.rotateStep,51);
                }
            }
            break;
    
        default:
            this.updateStatus();
            break;
    }
}