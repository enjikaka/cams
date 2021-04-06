/**
 * @typedef {'Pollen-Birch' | 'CO' | 'Pollen-Grass' | 'NH3' | 'NMVOC' | 'NO' | 'NO2' | 'O3' | 'PANs' | 'PM10' | 'PM2.5' | 'SO2'} AthmosphereType
 */

const atmosphereTypeToLayer = {
  'Pollen-Birch': 'composition_europe_pol_birch_forecast_surface',
  'CO': 'composition_europe_co_forecast_surface',
  'Pollen-Grass': 'composition_europe_pol_grass_forecast_surface',
  'NH3': 'composition_europe_nh3_forecast_surface',
  'NMVOC': 'composition_europe_nmvoc_forecast_surface',
  'NO': 'composition_europe_no_forecast_surface',
  'NO2': 'composition_europe_no2_forecast_surface',
  'O3': 'composition_europe_o3_forecast_surface',
  'PANs': 'composition_europe_pans_forecast_surface',
  'PM10': 'composition_europe_pm10_forecast_surface',
  'PM2.5': 'composition_europe_pm2p5_forecast_surface',
  'SO2': 'composition_europe_so2_forecast_surface'
};

// NUT: https://www.naturvardsverket.se/Stod-i-miljoarbetet/Vagledningar/Luft-och-klimat/Miljokvalitetsnormer-for-utomhusluft/Gransvarden-malvarden-utvarderingstrosklar/
const moderateLimit = {
  'Pollen-Birch': null,
  'CO': 5000,
  'Pollen-Grass': null,
  'NH3': null,
  'NMVOC': null,
  'NO': null,
  'NO2': 54,
  'O3': null,
  'PANs': null,
  'PM10': 25,
  'PM2.5': 10,
  'SO2': 100
};

// ÖUT: https://www.naturvardsverket.se/Stod-i-miljoarbetet/Vagledningar/Luft-och-klimat/Miljokvalitetsnormer-for-utomhusluft/Gransvarden-malvarden-utvarderingstrosklar/
const badLimit = {
  'Pollen-Birch': null,
  'CO': 7000,
  'Pollen-Grass': null,
  'NH3': null,
  'NMVOC': null,
  'NO': null,
  'NO2': 72,
  'O3': null,
  'PANs': null,
  'PM10': 35,
  'PM2.5': 25,
  'SO2': 150
};

function offset([long, lat], dn = 10, de = 10) {
  // Earth’s radius, sphere.
  const R = 6378137

  // Coordinate offsets in radians
  const dLat = dn / R
  const dLon = de / (R * Math.cos(Math.PI * lat / 180))

  // OffsetPosition, decimal degrees
  const latO = lat + dLat * 180 / Math.PI;
  const lonO = long + dLon * 180 / Math.PI;

  return [lonO, latO];
}

/**
 * @param {number[]} coord
 * @param {AthmosphereType} type
 */
async function get([long, lat], type) {
  const radius = 5000;
  const [longNW, latNW] = offset([long, lat], -(radius), -(radius));
  const [longSE, latSE] = offset([long, lat], radius, radius);

  const bbox = [latNW, longNW, latSE, longSE];

  const width = 200;
  const height = 200;
  const x = 100;
  const y = 100;
  const url = new URL('https://apps.ecmwf.int/wms/');

  const layer = atmosphereTypeToLayer[type];

  url.searchParams.set('service', 'wms');
  url.searchParams.set('version', '1.3.0');
  url.searchParams.set('request', 'GetFeatureInfo');
  url.searchParams.set('token', 'public');

  url.searchParams.set('layers', layer);
  url.searchParams.set('query_layers', layer);
  url.searchParams.set('info_format', 'application/json');

  url.searchParams.set('elevation', '0');
  url.searchParams.set('crs', 'EPSG:4326');
  url.searchParams.set('bbox', bbox.join(','));
  url.searchParams.set('width', width);
  url.searchParams.set('height', height);
  url.searchParams.set('x', x);
  url.searchParams.set('y', y);

  // Adding time currently errors out a python script on the CAMS WMS server...
  /*
  const dimRefTime = new Date().toJSON().split('T')[0] + 'T00:00:00Z';
  const time = new Date().toJSON().split(':')[0] + ':00:00Z';

  url.searchParams.set('DIM_REFERENCE_TIME', dimRefTime);
  url.searchParams.set('TIME', time);
  */

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error('Could not fetch data');
  }

  try {
    const json = await response.json();

    return {
      type,
      value: json.Probes[0].Value.Data,
      unit: json.Probes[0].Value.Unit
    };
  } catch (e) {
    return {
      type,
      value: null,
      unit: null
    };
  }
}

function getAll(coords) {
  /** @type {AthmosphereType[]} */
  const keys = Object.keys(atmosphereTypeToLayer);
  const promises = keys.map(type => get(coords, type));

  return Promise.all(promises);
}

async function handle (event) {
  const url = new URL(event.request.url);

  const lat = parseFloat(url.searchParams.get('lat'));

  if (Number.isNaN(lat)) {
   throw new ReferenceError('You did not provide a latitude value in the "lat" search parameter.');
  }

  const lng = parseFloat(url.searchParams.get('lng'));

  if (Number.isNaN(lng)) {
    throw new ReferenceError('You did not provide a longitude value in the "lat" search parameter.');
  }

  const atmosphereData = await getAll([lng, lat]);
  const responseData = atmosphereData.reduce((acc, curr) => {
    const { type, unit, value } = curr;

    return {
      ...acc,
      [type]: {
        unit,
        value
      }
    }
  }, {});

  const average = arr => arr.reduce( ( p, c ) => p + c, 0 ) / arr.length;

  const aqi = average([
    responseData['NO2'].value,
    responseData['PM10'].value,
    responseData['O3'].value,
    responseData['PM2.5'].value
  ]);

  let qualitativeName;

  if (aqi >= 100) {
    qualitativeName = 'very_high';
  }

  if (aqi < 100) {
    qualitativeName = 'high';
  }

  if (aqi < 75) {
    qualitativeName = 'medium';
  }

  if (aqi < 50) {
    qualitativeName = 'low';
  }

  if (aqi < 25) {
    qualitativeName = 'very_low';
  }

  responseData.aqi = {
    qualitativeName,
    value: aqi
  };

  const prettyPrint = event.request.headers.get('origin') === null;

  return new Response(JSON.stringify(responseData, null, prettyPrint ? 4 : undefined), {
    status: 200,
    headers: new Headers({
      'content-type': 'application/json'
    })
  });
}

function errorResponse (msg) {
  return new Response(msg, {
    status: 400,
  });
}

function nextHour () {
  const hh = new Date().getUTCHours();

  return hh < 24 ? hh + 1 : 0;
}

addEventListener('fetch', async event => {
  let response;

  try {
    response = await handle(event);

    // TODO: Set better cache headers when I have figured out how often CAMS updates these responses...
    const d = new Date();

    d.setUTCHours(nextHour());
    d.setUTCMinutes(0);
    d.setUTCSeconds(0);

    response.headers.set('Expires', d.toUTCString());

    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Request-Method', 'GET');
  } catch (e) {
    response = errorResponse(e.message);
  }

  event.respondWith(response);
});
