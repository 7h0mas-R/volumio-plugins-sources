'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var io = require('socket.io-client');
var socket = io.connect('http://localhost:3000');

var musicLib = 0;
var position = 0;
var tidyuri = "";
var tracks = null;
module.exports = randomizer;
function randomizer(context) {
	var self = this;
	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
}

randomizer.prototype.onVolumioStart = function()
{
    var self = this;
    var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);

    return libQ.resolve();
}

randomizer.prototype.onStart = function() {
    var self = this;
    var defer=libQ.defer();
    self.load18nStrings();
    // Once the Plugin has successfull started resolve the promise
    defer.resolve();

    return defer.promise;
};

randomizer.prototype.libTest = function() {
    var self = this;
    var defer=libQ.defer();
var Lib = 1;
  socket.emit('browseLibrary', {'uri':'albums://'});
  socket.on('pushBrowseLibrary',function(data)
  {
      var list = data.navigation.lists[0].items;
      var select  = list[0];
      var Lib = 0;
  });
  socket.off('pushBrowseLibrary');
return  Lib;
    // Once the Plugin has successfull started resolve the promise
    defer.resolve();

    return defer.promise;
}


randomizer.prototype.rand = function(max, min) {
    return Math.floor(Math.random() * (+max - +min)) + min;
}



randomizer.prototype.randomTracks = function() {
    var self = this;
    var defer=libQ.defer();
    var i = 0;
    var queue = 0;
    var list = 0; 
    self.tracks = self.config.get('tracks');
    if (isNaN(self.tracks)) self.tracks = 25;
    socket.emit('browseLibrary', {'uri':'albums://'});
    socket.on('pushBrowseLibrary',function(data) {
       var item = data.navigation.lists[0].items[0];
       var list = data.navigation.lists[0].items;
       if (list == 0)
       {
         self.commandRouter.pushToastMessage('error', self.getI18nString("ERROR_NO_LIBRARY_FOUND_TITLE"), self.getI18nString("ERROR_NO_TRACKS_LIBRARY_MESSAGE"));
         socket.off('pushBrowseLibrary');
         socket.off('pushQueue');
       }
       if (list !=0 && queue == 0)
       {
         socket.emit('clearQueue');
       }
       if (list !=0)
       {
         if (item.type == 'song')
         {
           try {
             while (item.type == 'song') {
               item = data.navigation.lists[0].items[i];
               i++;
             }
           }
           catch(err) {
             i-- ;
             var track = self.rand(i, 0);
             item = data.navigation.lists[0].items[track];
             i = 0;
           }
           if (queue <= self.tracks-1)
           {
             socket.emit('addToQueue', {'uri':item.uri});
             queue++ ;
           }
         } else {
           var list = data.navigation.lists[0].items;
           var random = self.rand(list.length - 1, 0);
           var select = list[random];
           socket.emit('browseLibrary', {'uri':select.uri});
         }
       }
    });
    socket.on('pushQueue', function(data) {
       if (data && data.length == 1) {
          socket.emit('play',{'value':0});
       }
       if (data.length >= self.tracks) {
          socket.off('pushBrowseLibrary');
          socket.off('pushQueue');
       } else {
          socket.emit('browseLibrary', {'uri':'albums://'});
       }
    });
    // Once the Plugin has successfully started resolve the promise
    defer.resolve();
    return libQ.resolve();
}




randomizer.prototype.trackToAlbum = function() {
    var self = this;
    var defer=libQ.defer();
    socket.emit('getState', '');
    socket.on('pushState', function (data) {
      if (data.uri.length == 0)
      {
        socket.off('pushState');
        socket.off('pushQueue');
        self.commandRouter.pushToastMessage('error', self.getI18nString("ERROR_QUEUE_EMPTY_TITLE"), self.getI18nString("ERROR_QUEUE_EMPTY_MESSAGE"));
      }
      if (data.service !='mpd' && data.uri.length !=0)
      {
        self.getI18nString("ERROR_NOT_MPD_TITLE")
        var serv = self.getI18nString("ERROR_NOT_MPD_TITLE").concat(" ", data.service , "."); 
        self.commandRouter.pushToastMessage('error', serv, self.getI18nString("ERROR_NOT_MPD_MESSAGE"));
        socket.off('pushState');
        socket.off('pushQueue');
      }
      if (data.service =='mpd' && data.uri.length != 0)
      {
           socket.emit('clearQueue');
           var album = (data.uri.lastIndexOf('/'));
           data.uri = data.uri.substring(0, album);
           socket.emit('addToQueue', {'uri': data.uri})
       }
       socket.off('pushState');
   });
   socket.on('pushQueue', function(data) {
     if (data && data.length > 0)
     {
       socket.emit('play',{'value':0});
       socket.off('pushQueue');
       socket.off('pushState');
     }
   });

   // Once the Plugin has successfull stopped resolve the promise
   defer.resolve();

   return libQ.resolve();
}

randomizer.prototype.randomAlbum = function() {
    var self = this;
    var defer=libQ.defer();
//    socket.emit('clearQueue');
    socket.emit('browseLibrary',{'uri':'albums://'});
    socket.on('pushBrowseLibrary',function(data)
    {
      var list = data.navigation.lists[0].items;
      if (list == 0)
      {
        self.commandRouter.pushToastMessage('error', self.getI18nString("ERROR_NO_LIBRARY_FOUND_TITLE"), self.getI18nString("ERROR_NO_ALBUM_LIBRARY_MESSAGE"));
        socket.off('pushBrowseLibrary');
        socket.off('pushQueue');
      }
      if (list != 0)
      {
        socket.emit('clearQueue');
        var q = self.rand(list.length, 0);
        var select = list[q];
        tidyuri = select.uri.replace(/%20/g, " ");
        socket.emit('addToQueue', {'uri':tidyuri})
      }
      socket.off('pushBrowseLibrary');    
    });
    socket.on('pushQueue', function(data) { 
      if (data.length > 0) {
        socket.emit('play',{'value':0});
        //socket.off('pushBrowseLibrary');
        socket.off('pushQueue');
      }
     });
    defer.resolve();
    return libQ.resolve();
}

randomizer.prototype.truePrevious = function() {
     var self = this;
     var defer=libQ.defer();
     var position = 0;
     socket.emit('getState', '');
     socket.on('pushState', function (data) {
     if (data.position >= 1)
     {
       socket.on('pushState', function () {
       });
       socket.emit("play",{"value":data.position - 1});
     } else {
        self.commandRouter.pushToastMessage('error', self.getI18nString("ERROR_START_OF_QUEUE_TITLE"), self.getI18nString("ERROR_START_OF_QUEUE_MESSAGE"));
     }
     socket.off('pushState');
  });
  // Once the Plugin has successfully started resolve the promise
  defer.resolve();
  return libQ.resolve();
};



randomizer.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();

    // Once the Plugin has successfull stopped resolve the promise
    defer.resolve();

    return libQ.resolve();
};

randomizer.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};

randomizer.prototype.saveSettings = function (data) {
    var self = this;
    var defer = libQ.defer();
    defer.resolve();
  
    if(isNaN(data['tracks'])) data['tracks'] = -1;
    if(data['tracks'] <= 0) {
        self.commandRouter.pushToastMessage('error', self.getI18nString("ERROR_NUMBER_PLEASE_TITLE"), self.getI18nString("ERROR_NUMBER_PLEASE_MESSAGE"));
      } else {
        self.commandRouter.pushToastMessage('success', self.getI18nString("SUCCESS_TITLE"), self.getI18nString("SUCCESS_MESSAGE"));
    }
    if(data['tracks'] >= 1) {
       self.config.set('tracks', parseInt(data['tracks']),10);
    }

    return defer.promise;
};


randomizer.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;
    var lang_code = this.commandRouter.sharedVars.get('language_code');
    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
            uiconf.sections[0].content[0].value = self.config.get('tracks');
            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });

    return defer.promise;
};

randomizer.prototype.load18nStrings = function () {
    var self = this;

    try {
        var language_code = this.commandRouter.sharedVars.get('language_code');
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_' + language_code + ".json");
    } catch (e) {
        self.i18nStrings = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
    }

    self.i18nStringsDefaults = fs.readJsonSync(__dirname + '/i18n/strings_en.json');
};

randomizer.prototype.getI18nString = function (key) {
    var self = this;

    if (self.i18nStrings[key] !== undefined)
        return self.i18nStrings[key];
    else
        return self.i18nStringsDefaults[key];
};


// Configuration Methods -----------------------------------------------------------------------------

randomizer.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

randomizer.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

randomizer.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

randomizer.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};




