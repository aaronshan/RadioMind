/**
 * Weather API - 天气服务
 * 获取当前天气，用于基于天气的音乐推荐
 */

const https = require('https');

class WeatherAPI {
  constructor() {
    // 使用 Open-Meteo 免费 API (无需 API Key)
    this.baseURL = 'api.open-meteo.com';
    this.cache = null;
    this.cacheTime = null;
    this.cacheDuration = 30 * 60 * 1000; // 30分钟缓存
  }

  /**
   * 获取当前天气
   * @param {number} lat - 纬度
   * @param {number} lon - 经度
   * @returns {Promise<Object>} 天气信息
   */
  async getCurrentWeather(lat = 39.9042, lon = 116.4074) {
    // 检查缓存
    if (this.cache && this.cacheTime &&
        (Date.now() - this.cacheTime) < this.cacheDuration) {
      console.log('[WeatherAPI] Using cached weather data');
      return this.cache;
    }

    try {
      const data = await this.fetchWeatherData(lat, lon);

      const weather = {
        temperature: data.current.temperature_2m,
        feelsLike: data.current.apparent_temperature,
        condition: this.getWeatherCondition(data.current.weather_code),
        description: this.getWeatherDescription(data.current.weather_code),
        humidity: data.current.relative_humidity_2m,
        windSpeed: data.current.wind_speed_10m,
        isDay: data.current.is_day === 1,
        timestamp: new Date().toISOString(),
        location: { lat, lon }
      };

      // 更新缓存
      this.cache = weather;
      this.cacheTime = Date.now();

      console.log(`[WeatherAPI] Current weather: ${weather.description}, ${weather.temperature}°C`);
      return weather;

    } catch (error) {
      console.error('[WeatherAPI] Error fetching weather:', error.message);
      // 返回默认天气
      return this.getDefaultWeather();
    }
  }

  /**
   * 获取城市天气
   * @param {string} city - 城市名（支持中文）
   * @returns {Promise<Object>} 天气信息
   */
  async getWeatherByCity(city = '北京') {
    // 常见城市坐标映射
    const cityCoordinates = {
      '北京': [39.9042, 116.4074],
      '上海': [31.2304, 121.4737],
      '广州': [23.1291, 113.2644],
      '深圳': [22.5431, 114.0579],
      '杭州': [30.2741, 120.1551],
      '成都': [30.5728, 104.0668],
      '武汉': [30.5928, 114.3055],
      '西安': [34.3416, 108.9398],
      '南京': [32.0603, 118.7969],
      '重庆': [29.5630, 106.5516],
    };

    const coords = cityCoordinates[city] || cityCoordinates['北京'];
    return this.getCurrentWeather(coords[0], coords[1]);
  }

  /**
   * 从 Open-Meteo API 获取数据
   */
  fetchWeatherData(lat, lon) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseURL,
        path: `/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day`,
        method: 'GET',
        timeout: 5000
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.current) {
              reject(new Error(`Unexpected response: ${data.slice(0, 200)}`));
              return;
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse weather data (${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Weather API timeout'));
      });

      req.end();
    });
  }

  /**
   * 根据天气代码获取天气状况
   */
  getWeatherCondition(code) {
    const conditions = {
      0: 'clear',           // 晴朗
      1: 'mainly-clear',    //  mainly clear
      2: 'partly-cloudy',   //  partly cloudy
      3: 'overcast',        //  overcast
      45: 'fog',            //  fog
      48: 'fog',            //  depositing rime fog
      51: 'drizzle',        //  drizzle
      53: 'drizzle',        //  drizzle
      55: 'drizzle',        //  drizzle
      61: 'rain',           //  rain
      63: 'rain',           //  rain
      65: 'rain',           //  rain
      71: 'snow',           //  snow
      73: 'snow',           //  snow
      75: 'snow',           //  snow
      77: 'snow',           //  snow grains
      80: 'rain',           //  rain showers
      81: 'rain',           //  rain showers
      82: 'rain',           //  rain showers
      85: 'snow',           //  snow showers
      86: 'snow',           //  snow showers
      95: 'thunderstorm',   //  thunderstorm
      96: 'thunderstorm',   //  thunderstorm with hail
      99: 'thunderstorm',   //  thunderstorm with hail
    };

    return conditions[code] || 'unknown';
  }

  /**
   * 获取天气描述（中文）
   */
  getWeatherDescription(code) {
    const descriptions = {
      0: '晴朗',
      1: '大部晴朗',
      2: '多云',
      3: '阴天',
      45: '雾',
      48: '雾凇',
      51: '毛毛雨',
      53: '小雨',
      55: '中雨',
      61: '小雨',
      63: '中雨',
      65: '大雨',
      71: '小雪',
      73: '中雪',
      75: '大雪',
      77: '雪粒',
      80: '阵雨',
      81: '强阵雨',
      82: '暴雨',
      85: '阵雪',
      86: '强阵雪',
      95: '雷暴',
      96: '雷暴伴冰雹',
      99: '强雷暴伴冰雹',
    };

    return descriptions[code] || '未知';
  }

  /**
   * 获取默认天气
   */
  getDefaultWeather() {
    return {
      temperature: 22,
      feelsLike: 22,
      condition: 'clear',
      description: '晴朗',
      humidity: 50,
      windSpeed: 5,
      isDay: true,
      timestamp: new Date().toISOString(),
      location: { lat: 39.9042, lon: 116.4074 },
      isDefault: true
    };
  }

  /**
   * 根据天气获取推荐标签
   */
  getMoodTags(weather) {
    const tags = [];

    // 根据天气状况
    switch (weather.condition) {
      case 'clear':
        tags.push('明亮', '活力', '开心');
        break;
      case 'partly-cloudy':
      case 'overcast':
        tags.push('舒缓', '温暖', '放松');
        break;
      case 'rain':
      case 'drizzle':
        tags.push('安静', '治愈', '抒情');
        break;
      case 'snow':
        tags.push('纯净', '宁静', '温馨');
        break;
      case 'thunderstorm':
        tags.push('激烈', '能量', '摇滚');
        break;
      case 'fog':
        tags.push('神秘', '氛围', '后摇');
        break;
    }

    // 根据温度
    if (weather.temperature > 30) {
      tags.push('清凉', '轻快');
    } else if (weather.temperature < 10) {
      tags.push('温暖', '治愈');
    }

    // 根据时间
    if (!weather.isDay) {
      tags.push('夜晚', '安静');
    }

    return tags;
  }

  /**
   * 获取天气相关的推荐语
   */
  getWeatherSegue(weather) {
    const segues = {
      'clear': [
        '今天天气真好，来首明媚的歌！',
        '阳光正好，让音乐也跟着灿烂起来~',
        '这么好的天气，需要一首开心的歌来搭配！'
      ],
      'rain': [
        '外面下着雨，来首适合雨天的歌...',
        '雨声淅沥，让音乐陪你度过这段时光。',
        '雨天最适合听这些歌了...'
      ],
      'snow': [
        '下雪了，整个世界都安静了下来...',
        '雪天和这首歌很配哦~',
        '窗外飘雪，来首温暖的歌。'
      ],
      'overcast': [
        '阴天适合听点舒缓的音乐...',
        '虽然天气阴沉，但音乐可以带来阳光。',
        '来首歌驱散阴霾吧！'
      ],
      'thunderstorm': [
        '雷雨交加，来首有能量的歌！',
        '让音乐盖过雷声！',
        '这种天气适合听点激烈的！'
      ]
    };

    const list = segues[weather.condition] || segues['clear'];
    return list[Math.floor(Math.random() * list.length)];
  }
}

module.exports = WeatherAPI;
