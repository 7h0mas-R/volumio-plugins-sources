'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var io = require('socket.io-client');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var font = require('font');
var lcd = require('lcd');
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

    self.SPIDevices = {};
    self.debugLogging = (self.config.get('logging')==true);
    self.opState = states.starting;
	if (self.debugLogging) self.logger.info('[EADOG_LCD] onStart: opState=' + self.opState + '. Starting plugin. Config: ' + JSON.stringify(self.config));
    self.socket = io.connect('http://localhost:3000');

    self.maxLine = 4;
    self.font_prop_16px = new font.Font();
    self.font_prop_8px = new font.Font();
    self.font_prop_16px.loadFontFromJSON('font_proportional_16px.json');
    self.font_prop_8px.loadFontFromJSON('font_proportional_8px.json');
    self.font_prop_16px.spacing = 0;
    self.activePage = 0;
    self.displayBlocked = false;
    self.statusNeedsUpdate = false;
    self.menuNeeded = false;
    self.selectedLine = 0;
    self.currentLevel = self.config.get('startLevel');
    self.loadI18nStrings(); 
    self.listSPIDevices() //get list of available SPI devices
    .then(_ =>  self.displayInitialize())
    .then(_ => defer.resolve())
    .fail(_ => defer.reject())
    return defer.promise;
};

eadogLcd.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();

    if (self.debugLogging) this.logger.info('[EADOG_LCD] onStop: stopping plugin')
    // if (self.display != undefined) {self.display.stopAnimation()};
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
            //SPI interface section
            var spiFromConfig = self.config.get('spiDev')
            var selected = 0;
            if (self.debugLogging) self.logger.info('[EADOG LCD] getUIConfig: Populating pull-down with ' + JSON.stringify(self.SPIDevices) + "  and selecting '" + spiFromConfig +  "'.'");
            for (var n = 0; n < self.SPIDevices.length; n++)
            {
                self.configManager.pushUIConfigParam(uiconf, 'sections[0].content[0].options', {
                    value: n+1,
                    label: self.SPIDevices[n]
                });
                if (self.SPIDevices[n] == spiFromConfig) {
                    selected = n+1;
                }
            };
            if (selected > 0) {
                uiconf.sections[0].content[0].value.value = selected;
                uiconf.sections[0].content[0].value.label = spiFromConfig;                
            }
			uiconf.sections[0].content[1].value = (self.config.get('rstPin'));
			uiconf.sections[0].content[2].value = (self.config.get('cdPin'));
			uiconf.sections[0].content[3].value = (self.config.get('speedHz'));
			uiconf.sections[0].content[4].value = (self.config.get('backlightPin'));
            //LCD settings section
			uiconf.sections[1].content[0].value.label = (self.config.get('lcdType'));
			uiconf.sections[1].content[1].value = (self.config.get('lcdInverted'));
			uiconf.sections[1].content[2].value = (self.config.get('lcdUpsideDown'));
            //Navigation settings section
			uiconf.sections[2].content[0].value = (self.config.get('startLevel'));
			uiconf.sections[2].content[1].value = (self.config.get('highestLevel'));
			uiconf.sections[2].content[2].value = (self.config.get('menuTimeout'));
			uiconf.sections[2].content[3].value = (self.config.get('splashScreenTimeout'));
            //Debug settings section
			uiconf.sections[3].content[0].value = (self.config.get('logging'));
            defer.resolve(uiconf);
        })
        .fail(function()
        {
            self.logger.error('[EADOG_LCD] getUIConfig: failed');
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

eadogLcd.prototype.displayInitialize = function() {
    var self = this;
    var defer = libQ.defer();

    if (self.checkConfig()) {
        if (self.debugLogging) this.logger.info('[EADOG_LCD] displayInitialize: now configuring display.');
        self.cdPin = self.config.get('cdPin');
        self.rstPin = self.config.get('rstPin');
        self.speedHz = self.config.get('speedHz');
        self.lcdUpsideDown = self.config.get('lcdUpsideDown');
        switch (self.config.get('lcdType')) {
            case 'DOG-S102':
                self.display = new lcd.DogS102();        
                break;
        
            default:
                self.display = new lcd.DogS102();        
                break;
        }
        self.displayBlocked = true;
        self.display.initialize({pinCd: self.cdPin, pinRst: self.rstPin, pinBacklight: 25, speedHz: self.speedHz, viewDirection: 0, volume: 6})
        .then(_ => self.display.hwReset(1000))
        //.then(_ => self.display.swReset())
        .then(_ => self.display.initialize({pinCd: self.cdPin, pinRst: self.rstPin, pinBacklight: 25, speedHz: self.speedHz, viewDirection: 0, volume: 10}))
        .then(_ => self.display.clear())
        .then(_ => self.display.backlightOn())
        // .then(_ => self.display.startAnimation(1000))
        .then(_ => self.display.moveToColPage(0,0))
        .then(_ => self.display.writeLine("UNDA 3.0",self.font_prop_16px,0))
        .then(_ => self.display.moveToColPage(0,3))
        .then(_ => self.display.writeLine("powered by",self.font_prop_8px,0))
        .then(_ => self.display.moveToColPage(0,4))
        .then(_ => self.display.writeLine("       Volumio 3",self.font_prop_8px,0))
        .then(_ => self.display.moveToColPage(0,7))
        .then(_ => self.display.writeLine("(C)2022 7h0mas-R",self.font_prop_8px,0))
        .then(_ => {
            let timeout = parseInt(self.config.get('splashScreenTimeout'));
            if (self.debugLogging) this.logger.info('[EADOG_LCD] onStart: setting SplashScreenTimer to ' + timeout + ' ms.')
            setTimeout(() => {
                self.opState = states.status;
                if (self.debugLogging) this.logger.info('[EADOG_LCD] onStart: SplashScreenTimer elapsed. New opState=' + self.opState);

                self.display.clear()
                .then(_ => {
                    self.displayBlocked = false;
                    if (self.menuNeeded) {
                        self.menuNeeded = false;
                        self.refreshDisplay()
                    } else if (self.statusNeedsUpdate) {
                        self.statusNeedsUpdate = false;
                        self.updateStatus();
                    }
                    self.activateListeners()
                })
            }, timeout)
        })    
        .then(_ => {
            setTimeout(() => {
                self.socket.emit('play');
            }, 3000)
        })    
         // Once the Plugin has successfull started resolve the promise
        .then(_ => defer.resolve())
        .catch(err => self.logger.error('[EADOG_LCD] onStart: failed with ', err))
    } else {
        if (self.debugLogging) this.logger.info('[EADOG_LCD] displayInitialize: SPI interface not yet configured, cannot init display yet.');
        self.commandRouter.pushToastMessage('info', self.getI18nString('TOAST_INFO'), self.getI18nString('TOAST_INFO_CONFIGINCOMPLETE'));
        defer.resolve();
    }
    return defer.promise;
}

eadogLcd.prototype.checkConfig = function () {
    var self = this;
    var configOK = true

    var spiDev = this.config.get('spiDev');
    var rstPin = this.config.get('rstPin');
    var cdPin = this.config.get('cdPin');
    var speedHz = this.config.get('speedHz');

    if (self.debugLogging) this.logger.info('[EADOG_LCD] checkConfig: ' + spiDev + ' ' + rstPin + ' ' + cdPin + ' ' + speedHz);
    if (spiDev==undefined || rstPin == undefined || cdPin == undefined || !self.SPIDevices.includes(spiDev)) configOK = false;
    if (spiDev=='...' || rstPin < 1 || cdPin < 1 || self.SPIDevices == '...') configOK = false;
    return configOK;
}

eadogLcd.prototype.activateListeners = function () {
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] activateListeners: activating now. opState=' + self.opState)
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
            self.refreshDisplay();
        }
    });
    self.socket.on('pushBrowseSources', function(data) {    
        self.menuItems = data;
        self.pageCount = Math.ceil(data.length/self.maxLine);
        self.activePage = 0;
        self.selectedLine = 0;
        self.refreshDisplay();
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
    //self.socket.emit('browseLibrary',{"uri":"radio/selection"});
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

    if (self.debugLogging) this.logger.info('[EADOG_LCD] up: Received up command in status:' + self.opState)
    switch (self.opState) {
        case states.menu:
            if (self.menuItems != undefined) {
                self.selectedItem = (self.activePage * self.maxLine + self.selectedLine)
                self.selectedItem = (self.selectedItem + self.menuItems.length - 1) % self.menuItems.length;
                self.activePage = Math.floor(self.selectedItem/self.maxLine);
                self.selectedLine = self.selectedItem % self.maxLine;
                self.refreshDisplay()
            }            
            break;
    
        default:
            self.opState = states.menu;
            self.refreshDisplay()
            break;
    }
    self.resetMenuTimer();
    return libQ.resolve();
}

eadogLcd.prototype.down = function(){
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] down: Received down command in status:' + self.opState)
    switch (self.opState) {
        case states.menu:
            if (self.menuItems != undefined) {
                self.selectedItem = (self.activePage * self.maxLine + self.selectedLine)
                self.selectedItem = (self.selectedItem + 1) % self.menuItems.length;
                self.activePage = Math.floor(self.selectedItem/self.maxLine);
                self.selectedLine = self.selectedItem % self.maxLine;
                self.refreshDisplay()
            }
            break;
    
        default:
            self.opState = states.menu;
            self.refreshDisplay()
            break;
    }
    self.resetMenuTimer();
    return libQ.resolve();
}

 eadogLcd.prototype.select = function(){
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] select: Received select command in status:' + self.opState)
    switch (self.opState) {
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
                    self.opState = states.status;
                case 'song':
                case 'playlist':
                    self.socket.emit('addPlay',self.menuItems[selectedItem])
                    self.opState = states.status;
                    break;
                default:
                    break;
            }
            break;
    
        default:
            self.opState = states.menu;
            self.refreshDisplay()
            break;
    }
    self.resetMenuTimer();
    return libQ.resolve();
}

 eadogLcd.prototype.addToQueueAndPlay = function(){
    var self = this;
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
}

 eadogLcd.prototype.replaceQueueAndPlay = function(){
    var self = this;
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
}
 eadogLcd.prototype.back = function(){
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] back: Received command in status:' + self.opState)
    switch (self.opState) {
        case states.menu:
            if (self.previousLevel != undefined) {
                if (self.previousLevel == "/") {
                    self.currentLevel = "/";
                    self.socket.emit('getBrowseSources');
                } else {
                    if (self.currentLevel != self.config.get('highestLevel')) {
                        self.currentLevel = self.previousLevel;
                    }
                    self.socket.emit('browseLibrary',{"uri":self.currentLevel})
                }
            }
            break;
    
        default:
            self.opState = states.menu;
            self.refreshDisplay()
            break;
    }
    self.resetMenuTimer();
    return libQ.resolve();
}

eadogLcd.prototype.resetMenuTimer = function () {
    var self = this;
}
eadogLcd.prototype.updateStatus = async function (status){
    var self = this;
    if (self.debugLogging) this.logger.info('[EADOG_LCD] updateStatus: ' + JSON.stringify(status));
    if (self.wsStatus === undefined) self.wsStatus = {};
    if (status !== undefined) {
        if (!self.displayBlocked) {
            self.displayBlocked = true;
            if (self.wsStatus.artist == undefined || status.artist != self.wsStatus.artist ) {
                if (self.debugLogging) this.logger.info('[EADOG_LCD] updateStatus - Artist: ' + status.artist);
                await self.display.moveToColPage(0,0);
                await self.display.writeLine(status.artist,self.font_prop_16px,fontStyles.normal);
            }
            if (self.wsStatus.title == undefined || status.title != self.wsStatus.title) {
                if (self.debugLogging) this.logger.info('[EADOG_LCD] updateStatus - Title: ' + status.title);
                await self.display.moveToColPage(0,2)
                await self.display.writeLine(status.title,self.font_prop_16px,fontStyles.normal);
            }
            await self.display.moveToColPage(0,4)
            await self.display.writeLine(" ",self.font_prop_16px,fontStyles.normal,animationTypes.none);
            if (self.wsStatus.status == undefined || status.status != self.wsStatus.status || status == undefined) {
                if (self.debugLogging) this.logger.info('[EADOG_LCD] updateStatus - Status: ' + status.status);
                await self.display.moveToColPage(0,6)
                await self.display.writeLine(status.status,self.font_prop_16px,fontStyles.normal);
            }
            self.wsStatus = status;
            self.displayBlocked = false;
            if (self.menuNeeded) {
                self.menuNeeded = false;
                self.refreshDisplay()
            } else if (self.statusNeedsUpdate) {
                self.statusNeedsUpdate = false;
                self.updateStatus()
            }
        } else {
            self.statusNeedsUpdate = true;
        }
    } 
}

eadogLcd.prototype.refreshDisplay = async function (){
    var self = this;
    if (self.debugLogging) self.logger.info('[EADOG_LCD] refreshDisplay: ' + self.opState);
    switch (self.opState) {
        case states.menu:
            let pagesPerLine = self.font_prop_16px._heightBytes;
            var style = 0;
            if (self.debugLogging) self.logger.info('[EADOG_LCD] refreshDisplay: Menuitems: ' + JSON.stringify(self.menuItems));
            if (!self.displayBlocked) {
                self.displayBlocked = true;
                await (self.display.clear())
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
                        await self.display.moveToColPage(0,i* pagesPerLine);
                        await self.display.writeLine(outputLine,self.font_prop_16px,style);
                    }
                }
                self.displayBlocked = false;
                if (self.menuNeeded) {
                    self.menuNeeded = false;
                    self.refreshDisplay()
                } else if (self.statusNeedsUpdate) {
                    self.statusNeedsUpdate = false;
                    self.updateStatus()
                }
            } else {

            }
            break;
    
        default:
            this.updateStatus();
            break;
    }
}

//read SPI devices available on RPi and store in self.SPIDevices
eadogLcd.prototype.listSPIDevices = function() {
    var self = this;
    var defer = libQ.defer();

    if (self.debugLogging) self.logger.info('[EADOG_LCD] listSPIDevices: Now checking for SPI devices');
    //read SPI devices with fs-extra.readdirSync because fs-extra.readdir returns "undefined" instead of a promise
    self.SPIDevices = fs.readdirSync('/dev').filter(file => file.startsWith('spidev'));
    if (self.debugLogging) self.logger.info('[EADOG_LCD] listSPIDevices: found ' + self.SPIDevices.length + ' devices.' + JSON.stringify(self.SPIDevices));
    if (self.SPIDevices.length > 0) {
        defer.resolve();
    } else {
        self.logger.error('[EADOG_LCD] listSPIDevices: Cannot get list of serial devices - ')
        defer.reject();
    }
    return defer.promise;
};

eadogLcd.prototype.updateSPISettings = function (data) {
    var self = this;
    var defer = libQ.defer();
    if (self.debugLogging) self.logger.info('[EADOG_LCD] updateSPISettings: Saving SPI Settings:' + JSON.stringify(data));
    self.config.set('spiDev', data['spiDev'].label);
    self.config.set('rstPin', parseInt(data['rstPin']));
    self.config.set('cdPin', parseInt(data['cdPin']));
    self.config.set('speedHz', parseInt(data['speedHz']));
    self.config.set('backlightPin', parseInt(data['backlightPin']));
    defer.resolve();
    self.commandRouter.pushToastMessage('success', self.getI18nString('TOAST_SAVE_SUCCESS'), self.getI18nString('TOAST_SPI_SAVE'));
    return defer.promise;
};

eadogLcd.prototype.updateLCDSettings = function (data) {
    var self = this;
    var defer = libQ.defer();
    if (self.debugLogging) self.logger.info('[EADOG_LCD] updateLCDSettings: Saving LCD Settings:' + JSON.stringify(data));
    self.config.set('lcdType', data['lcdType'].label);
    self.config.set('lcdInverted', (data['lcdInverted']));
    self.config.set('lcdUpsideDown', (data['lcdUpsideDown']));
    defer.resolve();
    self.commandRouter.pushToastMessage('success', self.getI18nString('TOAST_SAVE_SUCCESS'), self.getI18nString('TOAST_LCD_SAVE'));
    return defer.promise;
};

eadogLcd.prototype.updateNavigationSettings = function (data) {
    var self = this;
    var defer = libQ.defer();
    if (self.debugLogging) self.logger.info('[EADOG_LCD] updateNavigationSettings: Saving LCD Settings:' + JSON.stringify(data));
    self.config.set('startLevel', data['startLevel']);
    self.config.set('highestLevel', (data['highestLevel']));
    self.config.set('menuTimeout', (data['menuTimeout']));
    self.config.set('splashScreenTimeout', (data['splashScreenTimeout']));
    defer.resolve();
    self.commandRouter.pushToastMessage('success', self.getI18nString('TOAST_SAVE_SUCCESS'), self.getI18nString('TOAST_NAVIGATION_SAVE'));
    return defer.promise;
};

eadogLcd.prototype.updateDebugSettings = function (data) {
    var self = this;
    var defer = libQ.defer();
    if (self.debugLogging) self.logger.info('[EADOG_LCD] updateDebugSettings: Saving Debug Settings:' + JSON.stringify(data));
    self.config.set('logging', (data['logging']))
    self.debugLogging = data['logging'];
    defer.resolve();
    self.commandRouter.pushToastMessage('success', self.getI18nString('TOAST_SAVE_SUCCESS'), self.getI18nString('TOAST_DEBUG_SAVE'));
    return defer.promise;
};


// Retrieve a string
eadogLcd.prototype.getI18nString = function (key) {
    var self = this;

    if (self.i18nStrings['EADOG_LCD'][key] !== undefined) {
        if (self.debugLogging) self.logger.info('[EADOG_LCD] getI18nString("'+key+'"):'+ self.i18nStrings['EADOG_LCD'][key]);
        return self.i18nStrings['EADOG_LCD'][key];
    } else {
        if (self.debugLogging) self.logger.info('[EADOG_LCD] getI18nString("'+key+'")'+ self.i18nStringsDefaults['EADOG_LCD'][key]);
        return self.i18nStringsDefaults['EADOG_LCD'][key];
    };
}

// A method to get some language strings used by the plugin
eadogLcd.prototype.loadI18nStrings = function() {
    var self = this;

    try {
        var language_code = this.commandRouter.sharedVars.get('language_code');
        if (self.debugLogging) self.logger.info('[EADOG_LCD] loadI18nStrings: '+__dirname + '/i18n/strings_' + language_code + ".json");
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + language_code + ".json");
        // if (self.debugLogging) self.logger.info('[EADOG_LCD] loadI18nStrings: loaded: '+JSON.stringify(self.i18nStrings));
    }
    catch (e) {
        if (self.debugLogging) self.logger.info('[EADOG_LCD] loadI18nStrings: ' + language_code + ' not found. Fallback to en');
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    }

    self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
};

