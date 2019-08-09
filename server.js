"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const superagent = require("superagent");
const PORT = process.env.PORT || 3000;
const pg = require('pg');
const client = new pg.Client(process.env.DATABASE_URL);
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
client.connect();



function Location(city, geoData) {
  // console.log('DATA IS: ' + geoData.body.results);
  // console.log('CITY IS: ' + city);
  this.search_query = city;
  this.formatted_address = geoData.body.results[0].formatted_address;
  this.latitude = Number(geoData.body.results[0].geometry.location.lat);
  this.longitude = Number(geoData.body.results[0].geometry.location.lng);
}

function Forecast(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
}

function Event(event) {
  this.link = event.url;
  this.name = event.name.text;
  this.event_date = new Date(event.start.local).toString().slice(0, 15);
  this.summary = event.summary;
}

function Movie(movie) {
  this.title = movie.original_title;
  this.overview = movie.overview;
  this.average_votes = movie.vote_average;
  this.total_votes = movie.vote_count;
  this.image_url = movie.poster_path;
  this.popularity = movie.popularity;
  this.released_on = movie.release_date;
}
// app.use(express.static("./public"));
app.use(cors());

// Respond to GET requests from client
app.get("/location", lookupLocation);
app.get("/weather", getWeather);
app.get("/events", getEvents);

function handleError(error, response) {
  console.error(error);
  if (response) {
    response.status(500).send("Sorry, something went wrong here.");
  }
}

function searchLatLong(request, response) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${
    request.query.data
  }&key=${process.env.GEOCODE_API_KEY}`;

  superagent
    .get(url)
    .then(result => {
      const location = new Location(request.query.data, result);
      response.send(location);
    })
    .catch(error => handleError(error, response));
}

// Get weather data from DarkSky API
function getWeather(request, response) {
  const url = `https://api.darksky.net/forecast/${
    process.env.WEATHER_API_KEY
  }/${request.query.data.latitude},${request.query.data.longitude}`;

  superagent
    .get(url)
    .then(result => {
      const weatherResults = result.body.daily.data.map(
        day => new Forecast(day)
      );
      response.send(weatherResults);
    })
    .catch(error => handleError(error, response));
}

function getEvents(request, response) {
  // console.log("REQUEST : " + request.query.data.search_query);
  const url = `https://www.eventbriteapi.com/v3/events/search?token=${
    process.env.EVENTBRITE_API_KEY
  }&location.address=${request.query.data.search_query}`;
  superagent
    .get(url)
    .then(result => {
      // console.log(result.body);
      const events = result.body.events.map(data => {
        return new Event(data);
      });

      response.send(events);
    })
    .catch(error => handleError(error, response));
}

Location.prototype.save = function() {
  let NEWSQL = `INSERT INTO locations (search_query,formatted_address,latitude,longitude) VALUES($1,$2,$3,$4) RETURNING id`;
  let newValues = Object.values(this);
  return client.query(NEWSQL, newValues)
    .then( res => {
      return res.rows[0].id;      
    });
};

function lookupLocation(request, response) {

  const SQL = `SELECT * FROM locations WHERE search_query=$1;`;
  const values = [request.query];

  return client.query(SQL, values)
    .then(result => {
      if(result.rowCount > 0) {
        request.cacheHit(result);
      } else {
        
          fetchLocation(request.query).then(data => {
            response.send(data)
          });
        
        }
    })
    .catch(console.error);
};

function fetchLocation(query) {
  console.log(query);
  const _URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;
  return superagent.get(_URL)

    .then( data => {
      console.log(data);
      if ( ! data.body.results.length ) { throw 'No Data'; }
      else {
        let location = new Location(query, data);
        let loc = location.save()
          .then( res => {
            location.id = res;
            return location;
          });  
        return loc;
      }
    }); 
};

function getDataFromDB(sqlInfo) {
  // create the SQL statement
  let condition = '';
  let values = [];

  if (sqlInfo.searchQuery) {
    condition = 'search_query';
    values = [sqlInfo.searchQuery];

  } else {
    condition = 'location_id';
    values = [sqlInfo.id];
  }

  let sql = `SELECT * FROM ${sqlInfo.endpoint}s WHERE ${condition}=$1;`;

  // get the data and return it
  try { return client.query(sql, values); }
  catch (err) { handleError(err); }
}

// If we don't have existing data, this is how we will set aside in our DB
function saveDataToDB(sqlInfo) {
  // create the parameter placeholder
  let params = [];

  for (let i = 1; i <= sqlInfo.values.length; i++) {
    params.push(`$${i}`);
  }

  let sqlParams = params.join();

  let sql = '';

  if (sqlInfo.searchQuery) {
    // for location only
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams}) RETURNING ID;`;
  } else {
    // for all other endpoints
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams});`;
  }

  // save the data
  try { return client.query(sql, sqlInfo.values); }
  catch (err) { handleError(err); }

}

function getMovies(request, response) {
  let query = request.query.data.id;
  let sql = `SELECT * FROM movies WHERE location_id=$1;`;
  let values = [query];

  console.log('we are in the movies fn')
  client.query(sql, values)
    .then(result => {
      if (result.rowCount > 0) {
        // console.log('movie from SQL');
        response.send(result.rows);
      } else {
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIE_API_KEY}&query=${request.query.data.formatted_query}`;

        return superagent.get(url)
          .then(result => {
            console.log('MOVIE from API🎦', result.body.results, '🎦');
            if (!result.body.results.length) { throw 'NO DATA'; }
            else {
              const movieSummaries = result.body.results.map(movieData => {
                let movie = new Movie(movieData);
                movie.location_id = query;

                // these need to refactor
                // let newSQL = `INSERT INTO movies (title, overview, average_votes, total_votes, image_url, popularity, released_on, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`;
                // let newValues = Object.values(movie);

                client.query(newSQL, newValues);
                console.log('🎦', movie);

                return movie;
              });
              response.send(movieSummaries);
            }
          })
          .catch(error => handleError(error, response));
      }
    });
}
