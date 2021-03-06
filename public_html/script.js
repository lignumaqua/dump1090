// -*- mode: javascript; indent-tabs-mode: nil; c-basic-offset: 8 -*-
// Modified by Lignumaqua - Mike Wood - 1-14-16
//

"use strict";

// Define our global variables
var GoogleMap     = null;
var Weathertile   = null;
var europeOverlay = null;
var Planes        = {};
var PlanesOrdered = [];
var SelectedPlane = null;
var FollowSelected = false;

var TracksVisible = true;

var PredictedRange = [];
var PolyRange     = [];
var rangepoints  = [];

for (var j = 0; j < RangeAltitude.length; ++j) {
    PolyRange[j]	   =  new Uint32Array(361);
    rangepoints[j] = [];
}

var RangeDirty     = true;
var ShowRange      = false;
var ShowPredictedRange = true;
var rangeline    = new Array(null,null,null);
var RangeFill      = true;

var ShowHeatMap   = false;
var HeatMapValid  = false;
var ShowAll       = false;
var ShowWeather   = false;
var ShowLabels    = true;
var imageBounds   = {
        north: 72.05,
        south: 32.55,
        east: 51.25,
        west: -19.6
};
var AutoClosest   = false;
var UpdateAllIcons = false;

var SpecialSquawks = {
        '7500' : { cssClass: 'squawk7500', markerColor: 'rgb(255, 85, 85)', text: 'Aircraft Hijacking' },
        '7600' : { cssClass: 'squawk7600', markerColor: 'rgb(0, 255, 255)', text: 'Radio Failure' },
        '7700' : { cssClass: 'squawk7700', markerColor: 'rgb(255, 255, 0)', text: 'General Emergency' }
};

// Get current map settings
var CenterLat, CenterLon, ZoomLvl, MapType;

var Dump1090Version = "unknown version";
var RefreshInterval = 1000;

var PlaneRowTemplate = null;

var TrackedAircraft = 0;
var TrackedAircraftPositions = 0;
var TrackedHistorySize = 0;

var SitePosition = null;

var ReceiverClock = null;

var LastReceiverTimestamp = 0;
var StaleReceiverCount = 0;
var FetchPending = null;

var MessageCountHistory = [];
var MessageRate = 0;

var NBSP='\u00a0';

// Set and initialize Heatmap variables. Grid has HeatMapRange (400 x 400) boxes each approx 1 mile square
if (typeof HeatMapRange === 'undefined') {
    var HeatMapRange = 200;
}

var minlat = 90;
var maxlat = -90;
var minlon = 180;
var maxlon = -180;
var latstep = 0;
var lonstep = 0;
var HeatPoly = [];
for (var i = 0; i < (HeatMapRange * 2); ++i){
      var columns = [];
      for (var j = 0; j < (HeatMapRange * 2); ++j){
         columns[j] = 0;
      }
      HeatPoly[i] = columns;
    }
var HeatMapArray = [];

// Get current range array from locastorage
 if (localStorage && localStorage["PolyRange"]) {
    PolyRange = JSON.parse(localStorage["PolyRange"]);
}

function processReceiverUpdate(data) {
	// Loop through all the planes in the data packet
        var now = data.now;
        var acs = data.aircraft;

        // Detect stats reset
        if (MessageCountHistory.length > 0 && MessageCountHistory[MessageCountHistory.length-1].messages > data.messages) {
                MessageCountHistory = [{'time' : MessageCountHistory[MessageCountHistory.length-1].time,
                                        'messages' : 0}];
        }

        // Note the message count in the history
        MessageCountHistory.push({ 'time' : now, 'messages' : data.messages});
        // .. and clean up any old values
        if ((now - MessageCountHistory[0].time) > 30)
                MessageCountHistory.shift();

	for (var j=0; j < acs.length; j++) {
                var ac = acs[j];
                var hex = ac.hex;
                var plane = null;

		// Do we already have this plane object in Planes?
		// If not make it.

		if (Planes[hex]) {
			plane = Planes[hex];
		} else {
			plane = new PlaneObject(hex);
                        plane.tr = PlaneRowTemplate.cloneNode(true);

                        if (hex[0] === '~') {
                                // Non-ICAO address
                                plane.tr.cells[0].textContent = hex.substring(1);
                                $(plane.tr).css('font-style', 'italic');
                        } else {
                                plane.tr.cells[0].textContent = hex;
                        }

                        // set flag image if available
                        if (ShowFlags && plane.icaorange.flag_image !== null) {
                                $('img', plane.tr.cells[1]).attr('src', FlagPath + plane.icaorange.flag_image);
                                $('img', plane.tr.cells[1]).attr('title', plane.icaorange.country);
                        } else {
                                $('img', plane.tr.cells[1]).css('display', 'none');
                        }

                        plane.tr.addEventListener('click', selectPlaneByHex.bind(undefined,hex,false));
                        plane.tr.addEventListener('dblclick', selectPlaneByHex.bind(undefined,hex,true));
                        
                        Planes[hex] = plane;
                        PlanesOrdered.push(plane);
		}

		// Call the function update
		plane.updateData(now, ac);
	}
}

function fetchData() {
        if (FetchPending !== null && FetchPending.state() == 'pending') {
                // don't double up on fetches, let the last one resolve
                return;
        }

	FetchPending = $.ajax({ url: 'data/aircraft.json',
                                timeout: 5000,
                                cache: false,
                                dataType: 'json' });
        FetchPending.done(function(data) {
                var now = data.now;

                processReceiverUpdate(data);

                // update timestamps, visibility, history track for all planes - not only those updated
                for (var i = 0; i < PlanesOrdered.length; ++i) {
                        var plane = PlanesOrdered[i];
                        plane.updateTick(now, LastReceiverTimestamp);
                }
                
		refreshTableInfo();
		refreshSelected();
        refreshRange();
                
                if (ReceiverClock) {
                        var rcv = new Date(now * 1000);
                        ReceiverClock.render(rcv.getUTCHours(),rcv.getUTCMinutes(),rcv.getUTCSeconds());
                }

                // Check for stale receiver data
                if (LastReceiverTimestamp === now) {
                        StaleReceiverCount++;
                        if (StaleReceiverCount > 5) {
                                $("#update_error_detail").text("The data from dump1090 hasn't been updated in a while. Maybe dump1090 is no longer running?");
                                $("#update_error").css('display','block');
                        }
                } else { 
                        StaleReceiverCount = 0;
                        LastReceiverTimestamp = now;
                        $("#update_error").css('display','none');
                }
	});

        FetchPending.fail(function(jqxhr, status, error) {
                $("#update_error_detail").text("AJAX call failed (" + status + (error ? (": " + error) : "") + "). Maybe dump1090 is no longer running?");
                $("#update_error").css('display','block');
        });
}

var PositionHistorySize = 0;
function initialize() {
        // Set page basics
        document.title = PageName;
        $("#infoblock_name").text(PageName);

        PlaneRowTemplate = document.getElementById("plane_row_template");

        if (!ShowClocks) {
                $('#timestamps').css('display','none');
        } else {
                // Create the clocks.
		new CoolClock({
			canvasId:       "utcclock",
			skinId:         "classic",
			displayRadius:  40,
			showSecondHand: true,
			gmtOffset:      "0", // this has to be a string!
			showDigital:    false,
			logClock:       false,
			logClockRev:    false
		});

		ReceiverClock = new CoolClock({
			canvasId:       "receiverclock",
			skinId:         "classic",
			displayRadius:  40,
			showSecondHand: true,
			gmtOffset:      null,
			showDigital:    false,
			logClock:       false,
			logClockRev:    false
		});

                // disable ticking on the receiver clock, we will update it ourselves
                ReceiverClock.tick = (function(){})
        }

        $("#loader").removeClass("hidden");
        
        // Get receiver metadata, reconfigure using it, then continue
        // with initialization
        $.ajax({ url: 'data/receiver.json',
                 timeout: 5000,
                 cache: false,
                 dataType: 'json' })

                .done(function(data) {
                        if (typeof data.lat !== "undefined") {
                                SiteShow = true;
                                SiteLat = data.lat;
                                SiteLon = data.lon;
                                DefaultCenterLat = data.lat;
                                DefaultCenterLon = data.lon;
                        }
                        
                        Dump1090Version = data.version;
                        RefreshInterval = data.refresh;
                        PositionHistorySize = data.history;
                })

                .always(function() {
                        initialize_map();
                        start_load_history();
                });
}

var CurrentHistoryFetch = null;
var PositionHistoryBuffer = []
function start_load_history() {
        if (PositionHistorySize > 0) {
                $("#loader_progress").attr('max',PositionHistorySize);
                console.log("Starting to load history (" + PositionHistorySize + " items)");
                load_history_item(0);
        } else {
                end_load_history();
        }
}

function load_history_item(i) {
        if (i >= PositionHistorySize) {
                end_load_history();
                return;
        }

        console.log("Loading history #" + i);
        $("#loader_progress").attr('value',i);

        $.ajax({ url: 'data/history_' + i + '.json',
                 timeout: 5000,
                 cache: false,
                 dataType: 'json' })

                .done(function(data) {
                        PositionHistoryBuffer.push(data);
                        load_history_item(i+1);
                })

                .fail(function(jqxhr, status, error) {
                        // No more history
                        end_load_history();
                });
}

function end_load_history() {
        $("#loader").addClass("hidden");

        console.log("Done loading history");

        if (PositionHistoryBuffer.length > 0) {
                var now, last=0;

                // Sort history by timestamp
                console.log("Sorting history");
                PositionHistoryBuffer.sort(function(x,y) { return (x.now - y.now); });

                // Process history
                for (var h = 0; h < PositionHistoryBuffer.length; ++h) {
                        now = PositionHistoryBuffer[h].now;
                        console.log("Applying history " + h + "/" + PositionHistoryBuffer.length + " at: " + now);
                        processReceiverUpdate(PositionHistoryBuffer[h]);

                        // update track
                        console.log("Updating tracks at: " + now);
                        for (var i = 0; i < PlanesOrdered.length; ++i) {
                                var plane = PlanesOrdered[i];
                                plane.updateTrack((now - last) + 1);
                        }

                        last = now;
                }

                // Final pass to update all planes to their latest state
                console.log("Final history cleanup pass");
                for (var i = 0; i < PlanesOrdered.length; ++i) {
                        var plane = PlanesOrdered[i];
                        plane.updateTick(now);
                }

                LastReceiverTimestamp = last;
        }

        PositionHistoryBuffer = null;

        console.log("Completing init");

        refreshTableInfo();
        refreshSelected();
        reaper();

        selectClosest();

        // Setup our timer to poll from the server.
        window.setInterval(fetchData, RefreshInterval);
        window.setInterval(reaper, 60000);

        // And kick off one refresh immediately.
        fetchData();

        // Updating the heatmap is expensive, only do it once every 5 seconds.
        window.setInterval(refreshHeatmap, 5000);

        // Update US Weather Tiles once a minute.
        window.setInterval(refreshUSWeather, 60000);

        // Update Europe Weather Image once every 15 minutes.
        window.setInterval(refreshEUWeather, 15*60000);

        // Update Closest every 2 seconds.
        window.setInterval(selectClosest, 2000);

}

function generic_gettile(template, coord, zoom) {
        return template.replace('{x}', coord.x).replace('{y}', coord.y).replace('{z}', zoom)
}

// Initalizes the map and starts up our timers to call various functions
function initialize_map() {
        // Load stored map settings if present
        CenterLat = Number(localStorage['CenterLat']) || DefaultCenterLat;
        CenterLon = Number(localStorage['CenterLon']) || DefaultCenterLon;
        ZoomLvl = Number(localStorage['ZoomLvl']) || DefaultZoomLvl;
        MapType = localStorage['MapType'] || google.maps.MapTypeId.ROADMAP;
        if (localStorage['Tracks']) {
            TracksVisible =  JSON.parse(localStorage['Tracks']);
        }
        if (localStorage['ShowRange']) {
            ShowRange = JSON.parse(localStorage['ShowRange']);
        }
        if (localStorage['ShowPredictedRange']) {
            ShowPredictedRange = JSON.parse(localStorage['ShowPredictedRange']);
        }

        if (localStorage['RangeFill']) {
            RangeFill = JSON.parse(localStorage['RangeFill']);
        }

        if (localStorage['ShowAll']) {
            ShowAll = !JSON.parse(localStorage['ShowAll']);
            toggleColumns();
        }

         if (localStorage['ShowLabels']) {
            ShowLabels = JSON.parse(localStorage['ShowLabels']);
        }

        // Set SitePosition, initialize sorting
        if (SiteShow && (typeof SiteLat !==  'undefined') && (typeof SiteLon !==  'undefined')) {
	        SitePosition = new google.maps.LatLng(SiteLat, SiteLon);
                sortByDistance();
        } else {
	        SitePosition = null;
                PlaneRowTemplate.cells[6].style.display = 'none'; // hide distance column
                document.getElementById("distance").style.display = 'none'; // hide distance header
                sortByAltitude();
        }

        // Maybe hide flag info
        if (!ShowFlags) {
                PlaneRowTemplate.cells[1].style.display = 'none'; // hide flag column
                document.getElementById("flag").style.display = 'none'; // hide flag header
                document.getElementById("infoblock_country").style.display = 'none'; // hide country row
        }

	// Make a list of all the available map IDs
	var mapTypeIds = [];
	for(var type in google.maps.MapTypeId) {
		mapTypeIds.push(google.maps.MapTypeId[type]);
	}

	mapTypeIds.push("dark_map");

        for (var type in ExtraMapTypes) {
		mapTypeIds.push(type);
        }

	// Styled Map to outline airports and highways
	var styles = [
		{
			"featureType": "administrative",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "landscape",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "poi",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "road",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "transit",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "landscape",
			"stylers": [
				{ "visibility": "on" },
				{ "weight": 8 },
				{ "color": "#000000" }
			]
		},{
			"featureType": "water",
			"stylers": [
			{ "lightness": -74 }
			]
		},{
			"featureType": "transit.station.airport",
			"stylers": [
				{ "visibility": "on" },
				{ "weight": 8 },
				{ "invert_lightness": true },
				{ "lightness": 27 }
			]
		},{
			"featureType": "road.highway",
			"stylers": [
				{ "visibility": "simplified" },
				{ "invert_lightness": true },
				{ "gamma": 0.3 }
			]
		},{
			"featureType": "road",
			"elementType": "labels",
			"stylers": [
				{ "visibility": "off" }
			]
		}
	]

	// Add our styled map
	var styledMap = new google.maps.StyledMapType(styles, {name: "Dark Map"});

	// Define the Google Map
	var mapOptions = {
		center: new google.maps.LatLng(CenterLat, CenterLon),
		zoom: ZoomLvl,
		mapTypeId: MapType,
		mapTypeControl: true,
		streetViewControl: false,
                zoomControl: true,
                scaleControl: true,
		mapTypeControlOptions: {
			mapTypeIds: mapTypeIds,
			position: google.maps.ControlPosition.TOP_LEFT,
			style: google.maps.MapTypeControlStyle.DROPDOWN_MENU
		}
	};

	GoogleMap = new google.maps.Map(document.getElementById("map_canvas"), mapOptions);
	GoogleMap.mapTypes.set("dark_map", styledMap);
	
        // Define the extra map types
        for (var type in ExtraMapTypes) {
	        GoogleMap.mapTypes.set(type, new google.maps.ImageMapType({
		        getTileUrl: generic_gettile.bind(null, ExtraMapTypes[type]),
		        tileSize: new google.maps.Size(256, 256),
		        name: type,
		        maxZoom: 18
	        }));
        }

	// Listeners for newly created Map
        google.maps.event.addListener(GoogleMap, 'center_changed', function() {
                localStorage['CenterLat'] = GoogleMap.getCenter().lat();
                localStorage['CenterLon'] = GoogleMap.getCenter().lng();
                if (FollowSelected) {
                        // On manual navigation, disable follow
                        var selected = Planes[SelectedPlane];
                        if (Math.abs(GoogleMap.getCenter().lat() - selected.position.lat()) > 0.0001 &&
                            Math.abs(GoogleMap.getCenter().lng() - selected.position.lng()) > 0.0001) {
                                FollowSelected = false;
                                refreshSelected();
                        }
                }
        });
    
        google.maps.event.addListener(GoogleMap, 'zoom_changed', function() {
                localStorage['ZoomLvl']  = GoogleMap.getZoom();
                // Force refresh of heatmap is zoom is changed
                refreshHeatmap();
                // Update map icons when zoom changes
                UpdateAllIcons = true;
                for (var i = 0; i < PlanesOrdered.length; ++i) {
                    var plane = PlanesOrdered[i];
                    plane.updateIcon();
                }
                UpdateAllIcons = false;
                
        });
	
        google.maps.event.addListener(GoogleMap, 'maptypeid_changed', function() {
                localStorage['MapType'] = GoogleMap.getMapTypeId();
        });

        // US Weather
        Weathertile = new google.maps.ImageMapType({
            getTileUrl: function(tile, zoom) {
                return "http://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/" + zoom + "/" + tile.x + "/" + tile.y +".png?"+ (new Date()).getTime(); 
            },
            tileSize: new google.maps.Size(256, 256),
            opacity:0.3,
            name : 'NEXRAD',
            isPng: true
        });

        // European Weather

        if (localStorage['ShowWeather']) {
            ShowWeather = JSON.parse(localStorage['ShowWeather']);
        }
        if (ShowWeather) {
            // US
            GoogleMap.overlayMapTypes.push(Weathertile);
            // Europe
            showEUWeather();
        }

	// Add home marker if requested
	if (SitePosition) {
	    var markerImage = new google.maps.MarkerImage(
	        'http://maps.google.com/mapfiles/kml/pal4/icon57.png',
            new google.maps.Size(32, 32),   // Image size
            new google.maps.Point(0, 0),    // Origin point of image
            new google.maps.Point(16, 16)); // Position where marker should point 
	    var marker = new google.maps.Marker({
          position: SitePosition,
          map: GoogleMap,
          icon: markerImage,
          title: SiteName,
          zIndex: -99999
        });
        
        if (SiteCircles) {
            for (var i=0;i<SiteCirclesDistances.length;i++) {
              drawCircle(marker, SiteCirclesDistances[i]); // in meters
            }
        }
	}

    // Calculate extents for Heatmap 
    // HeatMapRange (200) miles N,S,E, and W from site

    if (SitePosition) {
        maxlat = google.maps.geometry.spherical.computeOffset(SitePosition, HeatMapRange * 1609,0).lat();
        minlat = google.maps.geometry.spherical.computeOffset(SitePosition, HeatMapRange * 1609,180).lat();
        maxlon = google.maps.geometry.spherical.computeOffset(SitePosition, HeatMapRange * 1609,90).lng();
        minlon = google.maps.geometry.spherical.computeOffset(SitePosition, HeatMapRange * 1609,270).lng();
        console.log(minlat, maxlat, minlon, maxlon);
        latstep = (maxlat - minlat)/(HeatMapRange *2);
        lonstep = (maxlon - minlon)/(HeatMapRange *2);
        HeatMapValid = true;
    }


    // Draw upintheair range polygons
    
        // Add terrain-limit rings. To enable this:
        //
        //  create a panorama for your receiver location on heywhatsthat.com
        //
        //  note the "view" value from the URL at the top of the panorama
        //    i.e. the XXXX in http://www.heywhatsthat.com/?view=XXXX
        //
        // fetch a json file from the API for the altitudes you want to see:
        //
        //  wget -O /usr/share/dump1090-mutability/html/upintheair.json \
        //    'http://www.heywhatsthat.com/api/upintheair.json?id=XXXX&refraction=0.25&alts=3048,9144'
        //
        // NB: altitudes are in _meters_, you can specify a list of altitudes

        // kick off an ajax request that will add the rings when it's done
        var request = $.ajax({ url: 'upintheair.json',
                               timeout: 5000,
                               cache: true,
                               dataType: 'json' });
        request.done(function(data) {
                var altitude_colors = ['#FF0000', '#0000FF', '#00FF00']; 
                for (var i = 0; i < data.rings.length; ++i) {
                        var points = data.rings[i].points;
                        var ring = [];
                        for (var j = 0; j < points.length; ++j) {
                                ring.push(new google.maps.LatLng(points[j][0], points[j][1]));
                        }
                        ring.push(ring[0]);
                        PredictedRange.push(new google.maps.Polyline({
                                path: ring,
                                strokeOpacity: 1.0,
                                strokeColor: altitude_colors[i],
                                strokeWeight: 2,
                                clickable: false}));
                }
                if (ShowPredictedRange) {
                    for (var j = 0; j < PredictedRange.length; ++j) {
                        PredictedRange[j].setMap(GoogleMap);
                    }
                }  
        });

        request.fail(function(jqxhr, status, error) {
                // no rings available, do nothing
        });

    // Draw heatmap from 400x400 array
        if (HeatMapValid) {
        window.heatmap = new google.maps.visualization.HeatmapLayer({
            data: HeatMapArray,
            dissipating: true,
            radius: 15,
            opacity: 0.6});
        }


        
}

// This looks for planes to reap out of the master Planes variable
function reaper() {
        //console.log("Reaping started..");

	// Look for planes where we have seen no messages for >300 seconds
        var newPlanes = [];
        for (var i = 0; i < PlanesOrdered.length; ++i) {
                var plane = PlanesOrdered[i];
                if (plane.seen > 300) {
			// Reap it.                                
                        //console.log("Reaping " + plane.icao);
                        //console.log("parent " + plane.tr.parentNode);
                        plane.tr.parentNode.removeChild(plane.tr);
                        plane.tr = null;
			delete Planes[plane.icao];
                        plane.destroy();
		} else {
                        // Keep it.
                        newPlanes.push(plane);
		}
	};

        PlanesOrdered = newPlanes;
        refreshTableInfo();
        refreshSelected();
}

// Page Title update function
function refreshPageTitle() {
        if (!PlaneCountInTitle && !MessageRateInTitle)
                return;

        var subtitle = "";

        if (PlaneCountInTitle) {
                subtitle += TrackedAircraftPositions + '/' + TrackedAircraft;
        }

        if (MessageRateInTitle) {
                if (subtitle) subtitle += ' | ';
                subtitle += MessageRate.toFixed(1) + '/s';
        }

        document.title = PageName + ' - ' + subtitle;
}

// Refresh range polygon
function refreshRange() {
    if (RangeDirty) {
        for (var j = 0; j < RangeAltitude.length; ++j) {
            //rangepoints[j] = [];
            for (var a = 0; a < 360; ++a) {
                rangepoints[j][a] = google.maps.geometry.spherical.computeOffset(SitePosition, PolyRange[j][a], a);
            }
            // Close polyline
            rangepoints[j][360] = rangepoints[j][0];    
        
        
            if (rangeline[j]) {
                rangeline[j].setPath(rangepoints[j]);
                rangeline[j].setOptions({fillOpacity: (RangeFill ? 0.1 : 0)});
            } else {
                rangeline[j] = new google.maps.Polygon({path: rangepoints[j], strokeColor: RangeColor[j], strokeWeight: 2, strokeOpacity: 1, clickable: false, fillColor: RangeColor[j], fillOpacity: (RangeFill ? 0.1 : 0) });
            }
        }
        // Store array in localstorage
        localStorage["PolyRange"] = JSON.stringify(PolyRange);
        RangeDirty = false;
        if (ShowRange) {
            for (var j = 0; j < RangeAltitude.length; ++j) {
                rangeline[j].setMap(GoogleMap);
            }
        }
    }
}

// Refresh Heat Map Array
function refreshHeatmap() {
    if (HeatMapValid) {
        HeatMapArray = [];
        var heatmapmax = 0;
        // Iterate through each of our HeatMapRange (400 x 400) boxes (little slow but a lot quicker than running on the raw data)
        for (var i = 0; i < (HeatMapRange * 2); ++i){
            for (var j = 0; j < (HeatMapRange * 2); ++j){
                if (HeatPoly[i][j] > 0) {
                    if (HeatPoly[i][j] > heatmapmax) {
                        heatmapmax = HeatPoly[i][j];
                    }
                    var weightedLoc = {
                        location: new google.maps.LatLng(minlat+(latstep * i),minlon+(lonstep*j)),
                        weight: HeatPoly[i][j]
                    };
                    HeatMapArray.push(weightedLoc);
                }
            }
        }
        heatmap.set('data', HeatMapArray);

        // Rescale data to current levels
        heatmap.set('maxIntensity', heatmapmax);

        // Set radius relative to zoom size
        // zooming in needs larger radius to look correct
        var curzoom = GoogleMap.getZoom();
        var zoomarray = [4,4,4,4,4,4,4,8,12,25,45,45,45,45,45,45,45,45,45,45];
        heatmap.set('radius', zoomarray[curzoom]);
    }
}


// Refresh US Weather Tiles
function refreshUSWeather() {
    if (ShowWeather) {
        GoogleMap.overlayMapTypes.clear();
        GoogleMap.overlayMapTypes.push(Weathertile);
    }
}

// Refresh EU Weather Image
function refreshEUWeather() {
    europeOverlay.setMap(null);
    if (ShowWeather) {
        showEUWeather();
    }
}




// Refresh the detail window about the plane
function refreshSelected() {
        if (MessageCountHistory.length > 1) {
                var message_time_delta = MessageCountHistory[MessageCountHistory.length-1].time - MessageCountHistory[0].time;
                var message_count_delta = MessageCountHistory[MessageCountHistory.length-1].messages - MessageCountHistory[0].messages;
                if (message_time_delta > 0)
                        MessageRate = message_count_delta / message_time_delta;
        } else {
                MessageRate = null;
        }

	refreshPageTitle();
       
        var selected = false;
	if (typeof SelectedPlane !== 'undefined' && SelectedPlane != "ICAO" && SelectedPlane != null) {
    	        selected = Planes[SelectedPlane];
        }
        
        $('#dump1090_infoblock').css('display','block');
        $('#dump1090_version').text(Dump1090Version);
        $('#dump1090_total_ac').text(TrackedAircraft);
        $('#dump1090_total_ac_positions').text(TrackedAircraftPositions);
        $('#dump1090_total_history').text(TrackedHistorySize);

        if (MessageRate !== null) {
                $('#dump1090_message_rate').text(MessageRate.toFixed(1));
        } else {
                $('#dump1090_message_rate').text("n/a");
        }


        if (!selected) {
                $('#selected_infoblock').css('display','none');
            return;
        }
               
        
        // $('#dump1090_infoblock').css('display','none');
        $('#selected_infoblock').css('display','block');

        $('#selected_flightaware_link').attr('href','http://flightaware.com/live/modes/'+selected.icao+'/redirect');
        
        if (selected.flight !== null && selected.flight !== "") {
                $('#selected_callsign').text(selected.flight);
                $('#selected_links').css('display','inline');
                $('#selected_fr24_link').attr('href','http://fr24.com/'+selected.flight);
                $('#selected_flightstats_link').attr('href','http://www.flightstats.com/go/FlightStatus/flightStatusByFlight.do?flightNumber='+selected.flight);
        } else {
                $('#selected_callsign').text('n/a');
                $('#selected_links').css('display','none');
        }

        if (selected.registration !== null) {
                $('#selected_registration').text(selected.registration);
        } else {
                $('#selected_registration').text("");
        }

        if (selected.icaotype !== null) {
                $('#selected_icaotype').text(selected.icaotype);
        } else {
                $('#selected_icaotype').text("");
        }

        var emerg = document.getElementById('selected_emergency');
        if (selected.squawk in SpecialSquawks) {
                emerg.className = SpecialSquawks[selected.squawk].cssClass;
                emerg.textContent = NBSP + 'Squawking: ' + SpecialSquawks[selected.squawk].text + NBSP ;
        } else {
                emerg.className = 'hidden';
        }

        $("#selected_altitude").text(format_altitude_long(selected.altitude, selected.vert_rate));

        if (selected.squawk === null || selected.squawk === '0000') {
                $('#selected_squawk').text('n/a');
        } else {
                $('#selected_squawk').text(selected.squawk);
        }
	
        $('#selected_speed').text(format_speed_long(selected.speed));
        $('#selected_icao').text(selected.icao.toUpperCase());
        $('#airframes_post_icao').attr('value',selected.icao);
	$('#selected_track').text(format_track_long(selected.track));

        if (selected.seen <= 1) {
                $('#selected_seen').text('now');
        } else {
                $('#selected_seen').text(selected.seen.toFixed(1) + 's');
        }

        $('#selected_country').text(selected.icaorange.country);
        if (ShowFlags && selected.icaorange.flag_image !== null) {
                $('#selected_flag').removeClass('hidden');
                $('#selected_flag img').attr('src', FlagPath + selected.icaorange.flag_image);
                $('#selected_flag img').attr('title', selected.icaorange.country);
        } else {
                $('#selected_flag').addClass('hidden');
        }

	if (selected.position === null) {
                $('#selected_position').text('n/a');
                $('#selected_follow').addClass('hidden');
        } else {
                var mlat_bit = (selected.position_from_mlat ? "MLAT: " : "");
                if (selected.seen_pos > 1) {
                        $('#selected_position').text(mlat_bit + format_latlng(selected.position) + " (" + selected.seen_pos.toFixed(1) + "s)");
                } else {
                        $('#selected_position').text(mlat_bit + format_latlng(selected.position));
                }
                $('#selected_follow').removeClass('hidden');
                if (FollowSelected) {
                        $('#selected_follow').css('font-weight', 'bold');
                        GoogleMap.panTo(selected.position);
                } else {
                        $('#selected_follow').css('font-weight', 'normal');
                }
	}
        
        $('#selected_sitedist').text(format_distance_long(selected.sitedist));
        $('#selected_sitebearing').text(format_bearing(selected.bearing));
        $('#selected_rssi').text(selected.rssi.toFixed(1) + ' dBFS');
}

// Refreshes the larger table of all the planes
function refreshTableInfo() {
        var show_squawk_warning = false;

        TrackedAircraft = 0
        TrackedAircraftPositions = 0
        TrackedHistorySize = 0

        for (var i = 0; i < PlanesOrdered.length; ++i) {
		var tableplane = PlanesOrdered[i];
                TrackedHistorySize += tableplane.history_size;
		if (!tableplane.visible) {
                        tableplane.tr.className = "plane_table_row hidden";
                } else {
                        TrackedAircraft++;
                        var classes = "plane_table_row";

		        if (tableplane.position !== null && tableplane.seen_pos < 60) {
                                ++TrackedAircraftPositions;
                                if (tableplane.position_from_mlat)
                                        classes += " mlat";
				else
                                        classes += " vPosition";
			}
			if (tableplane.icao == SelectedPlane)
                                classes += " selected";
                        
                        if (tableplane.squawk in SpecialSquawks) {
                                classes = classes + " " + SpecialSquawks[tableplane.squawk].cssClass;
                                show_squawk_warning = true;
			}			                

                        // ICAO doesn't change
                        tableplane.tr.cells[2].textContent = (tableplane.flight !== null ? tableplane.flight : "");
                        tableplane.tr.cells[3].textContent = (tableplane.squawk !== null ? tableplane.squawk : "");
                        tableplane.tr.cells[4].textContent = format_altitude_brief(tableplane.altitude, tableplane.vert_rate);
                        tableplane.tr.cells[5].textContent = format_speed_brief(tableplane.speed);
                        tableplane.tr.cells[6].textContent = format_distance_brief(tableplane.sitedist);
                        tableplane.tr.cells[7].textContent = format_track_brief(tableplane.track);
                        tableplane.tr.cells[8].textContent = tableplane.messages;
                        tableplane.tr.cells[9].textContent = tableplane.seen.toFixed(0);
                        tableplane.tr.className = classes;
		}
	}

	if (show_squawk_warning) {
                $("#SpecialSquawkWarning").css('display','block');
        } else {
                $("#SpecialSquawkWarning").css('display','none');
        }

        resortTable();
}

//
// ---- table sorting ----
//

function compareAlpha(xa,ya) {
        if (xa === ya)
                return 0;
        if (xa < ya)
                return -1;
        return 1;
}

function compareNumeric(xf,yf) {
        if (Math.abs(xf - yf) < 1e-9)
                return 0;

        return xf - yf;
}

function sortByICAO()     { sortBy('icao',    compareAlpha,   function(x) { return x.icao; }); }
function sortByFlight()   { sortBy('flight',  compareAlpha,   function(x) { return x.flight; }); }
function sortBySquawk()   { sortBy('squawk',  compareAlpha,   function(x) { return x.squawk; }); }
function sortByAltitude() { sortBy('altitude',compareNumeric, function(x) { return (x.altitude == "ground" ? -1e9 : x.altitude); }); }
function sortBySpeed()    { sortBy('speed',   compareNumeric, function(x) { return x.speed; }); }
function sortByDistance() { sortBy('sitedist',compareNumeric, function(x) { return x.sitedist; }); }
function sortByTrack()    { sortBy('track',   compareNumeric, function(x) { return x.track; }); }
function sortByMsgs()     { sortBy('msgs',    compareNumeric, function(x) { return x.messages; }); }
function sortBySeen()     { sortBy('seen',    compareNumeric, function(x) { return x.seen; }); }
function sortByCountry()  { sortBy('country', compareAlpha,   function(x) { return x.icaorange.country; }); }

var sortId = '';
var sortCompare = null;
var sortExtract = null;
var sortAscending = true;

function sortFunction(x,y) {
        var xv = x._sort_value;
        var yv = y._sort_value;

        // always sort missing values at the end, regardless of
        // ascending/descending sort
        if (xv == null && yv == null) return x._sort_pos - y._sort_pos;
        if (xv == null) return 1;
        if (yv == null) return -1;

        var c = sortAscending ? sortCompare(xv,yv) : sortCompare(yv,xv);
        if (c !== 0) return c;

        return x._sort_pos - y._sort_pos;
}

function resortTable() {
        // number the existing rows so we can do a stable sort
        // regardless of whether sort() is stable or not.
        // Also extract the sort comparison value.
        for (var i = 0; i < PlanesOrdered.length; ++i) {
                PlanesOrdered[i]._sort_pos = i;
                PlanesOrdered[i]._sort_value = sortExtract(PlanesOrdered[i]);
        }

        PlanesOrdered.sort(sortFunction);
        
        var tbody = document.getElementById('tableinfo').tBodies[0];
        for (var i = 0; i < PlanesOrdered.length; ++i) {
                tbody.appendChild(PlanesOrdered[i].tr);
        }
}

function sortBy(id,sc,se) {
        if (id === sortId) {
                sortAscending = !sortAscending;
                PlanesOrdered.reverse(); // this correctly flips the order of rows that compare equal
        } else {
                sortAscending = true;
        }

        sortId = id;
        sortCompare = sc;
        sortExtract = se;

        resortTable();
}

function selectPlaneByHex(hex,autofollow) {
        //console.log("select: " + hex);
	// If SelectedPlane has something in it, clear out the selected
	if (SelectedPlane != null) {
		Planes[SelectedPlane].selected = false;
		Planes[SelectedPlane].clearLines();
		Planes[SelectedPlane].updateMarker();
                $(Planes[SelectedPlane].tr).removeClass("selected");
	}

	// If we are clicking the same plane, we are deselected it.
	if (SelectedPlane === hex) {
                hex = null;
        }

    if (hex !== null) {
		// Assign the new selected
		SelectedPlane = hex;
		Planes[SelectedPlane].selected = true;
        Planes[SelectedPlane].clearLines();
		Planes[SelectedPlane].updateLines();
		Planes[SelectedPlane].updateMarker();
                $(Planes[SelectedPlane].tr).addClass("selected");
	} else { 
		SelectedPlane = null;
	}

    if (SelectedPlane !== null && autofollow) {
                FollowSelected = true;
                if (GoogleMap.getZoom() < 8)
                        GoogleMap.setZoom(8);
    } else {
            FollowSelected = false;
    } 

    refreshSelected();
    // Turn off AutoClosest if plane is selected manually 
    AutoClosest = false;
    
}

function toggleFollowSelected() {
        FollowSelected = !FollowSelected;
        if (FollowSelected && GoogleMap.getZoom() < 8)
                GoogleMap.setZoom(8);
        refreshSelected();
}

function resetMap() {
        // Reset localStorage values and map settings
        localStorage['CenterLat'] = CenterLat = DefaultCenterLat;
        localStorage['CenterLon'] = CenterLon = DefaultCenterLon;
        localStorage['ZoomLvl']   = ZoomLvl = DefaultZoomLvl;
        localStorage['MapType']   = MapType = google.maps.MapTypeId.ROADMAP;

        // Set and refresh
	GoogleMap.setZoom(ZoomLvl);
	GoogleMap.setCenter(new google.maps.LatLng(CenterLat, CenterLon));
	
	selectPlaneByHex(null,false);
}

function drawCircle(marker, distance) {
    if (typeof distance === 'undefined') {
        return false;

        distance = parseFloat(distance);
        if (isNaN(distance) || !isFinite(distance) || distance < 0) {
            return false;
        }
    }

    var labeldistance = distance;
    
    distance *= 1000.0;
    if (!Metric) {
        distance *= 1.852;
    }
    
    // Add circle overlay and bind to marker
    var circle = new google.maps.Circle({
      map: GoogleMap,
      radius: distance, // In meters
      fillOpacity: 0.0,
      strokeWeight: 1,
      strokeOpacity: 0.3
    });
    circle.bindTo('center', marker, 'position');

    var labelposition = google.maps.geometry.spherical.computeOffset(SitePosition, distance,90);

        // Add label to circle
    var circlelabel = new MapLabel({
          text: labeldistance,
          position: labelposition,
          map: GoogleMap,
          fontSize: 14,
          align: 'center',
          strokeWeight: 2,
          fontColor: '#101010',
          yoffset: -7
        });
}


function toggleTracks() {
        // Toggle showing all plane tracks or just selected plane
        TracksVisible = !TracksVisible;
        localStorage['Tracks'] = JSON.stringify(TracksVisible);
        for (var i = 0; i < PlanesOrdered.length; ++i) {
                if (!TracksVisible) {
                PlanesOrdered[i].clearLines();
            } else {
                PlanesOrdered[i].updateLines();
            }
        }
}


function resetRange() {
        // Reset rangle polygons
        for (var j = 0; j < RangeAltitude.length; ++j) {
            for (var a = 0; a < 361; ++a) {
                PolyRange[j][a] = 0;
            }
        }
        // Store array in localstorage
        localStorage['PolyRange'] = JSON.stringify(PolyRange);   
}


function toggleHeatmap() {
    if (HeatMapValid) {
         heatmap.setMap(heatmap.getMap() ? null : GoogleMap);
         refreshHeatmap();
    }
}

function toggleWeather() {
    if (ShowWeather) {
        GoogleMap.overlayMapTypes.clear();
        europeOverlay.setMap(null);
        ShowWeather = false;
    } else {
        // US
        GoogleMap.overlayMapTypes.push(Weathertile);
        // Europe
        showEUWeather();
        ShowWeather = true;
    }
    localStorage['ShowWeather'] = JSON.stringify(ShowWeather);   
}

function toggleRange() {
    if (ShowRange) {
        for (var j = 0; j < RangeAltitude.length; ++j) {
            rangeline[j].setMap(null);
        }
    } else {
        RangeDirty = true;
        for (var j = 0; j < RangeAltitude.length; ++j) {
            rangeline[j].setMap(GoogleMap);
        }
        refreshRange();
    }
    ShowRange = !ShowRange;
    localStorage['ShowRange'] = JSON.stringify(ShowRange);   
}

function togglePredictedRange() {
    if (ShowPredictedRange) {
        for (var j = 0; j < PredictedRange.length; ++j) {
            PredictedRange[j].setMap(null);
        }
    } else {
        for (var j = 0; j < PredictedRange.length; ++j) {
            PredictedRange[j].setMap(GoogleMap);
        }
    }
    ShowPredictedRange = !ShowPredictedRange;
    localStorage['ShowPredictedRange'] = JSON.stringify(ShowPredictedRange);   
}



function toggleColumns() {
    if (ShowAll) {
         $('td:nth-child(4)').hide();
         $('td:nth-child(9)').hide();
         $('td:nth-child(10)').hide();
         document.getElementById("map_canvas").style.marginRight = "320px";
         document.getElementById("sidebar_container").style.marginLeft = "-320px";
         document.getElementById("sidebar_container").style.width = "320px";
    } else {
        $('td:nth-child(4)').show();
        $('td:nth-child(9)').show();
        $('td:nth-child(10)').show();
        document.getElementById("map_canvas").style.marginRight = "380px";
        document.getElementById("sidebar_container").style.marginLeft = "-380px";
        document.getElementById("sidebar_container").style.width = "380px";
    }
    ShowAll = !ShowAll;
    localStorage['ShowAll'] = JSON.stringify(ShowAll);   
}

function formatdate(x) {
        if (x < 10) {x = "0" + x;}
        return String(x);
}

function weatherTimestamp() {
    // Need UTC time that is 15 minutes ago rounded down to the nearest prior 15 minute interval
    var timestamp = "";
    // Subtract 15 minutes from current UTC time
    var d = new Date(new Date() - 15*60000);
    //Year
    timestamp = timestamp + String(d.getUTCFullYear());
    
    //Month
    timestamp = timestamp + formatdate(d.getUTCMonth() + 1);

    //Date
    timestamp = timestamp + formatdate(d.getUTCDate());

    //Hour
    timestamp = timestamp + formatdate(d.getUTCHours());

    //Minutes
    var minute = d.getUTCMinutes();
    minute = (Math.floor(minute / 15)) * 15;
    timestamp = timestamp + formatdate(minute);

    return timestamp;
}

function showEUWeather() {
    // Europe
    europeOverlay = new google.maps.GroundOverlay(
        'http://api.meteoradar.co.uk/image/1.0/?time=' + weatherTimestamp() + '&type=radareuropa#fScheme',
        imageBounds,
        {opacity: .5});
    europeOverlay.setMap(GoogleMap);
}

function selectClosest () {
    if (AutoClosest) {
        var planeClosestIcao = null;
        var minDist = 9999999999;
        for (var i = 0; i < PlanesOrdered.length; ++i) {
            var plane = PlanesOrdered[i];
            if (plane.visible && plane.sitedist && (plane.sitedist < minDist)) {
                minDist = plane.sitedist;
                planeClosestIcao = plane.icao;
            }
        }
        // Only select this plane if it isnt already selected
        if (SelectedPlane != planeClosestIcao) {
            selectPlaneByHex(planeClosestIcao,false);
            // Reset the flag as it is reset by selectPlaneByHex()
            AutoClosest = true;
        }
        //console.log("Closest " + minDist + planeClosestIcao);
    }
}

function toggleSelectClosest() {
    AutoClosest = !AutoClosest;
    selectClosest();
}

function toggleRangeFill() {
    RangeFill = !RangeFill;
    localStorage['RangeFill'] = JSON.stringify(RangeFill);
    RangeDirty = true;
    refreshRange();
}

function toggleLabels() {
    ShowLabels = !ShowLabels;
    localStorage['ShowLabels'] = JSON.stringify(ShowLabels);
}