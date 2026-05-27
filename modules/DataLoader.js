/**
 * DataLoader.js — Async Network Data Loading
 * 
 * Fetches infrastructure data from external JSON file using Fetch API.
 * Includes comprehensive error handling, retry logic, and validation.
 */

import { appState } from './AppState.js';

export class DataLoader {
  constructor(baseUrl = './data/') {
    this.baseUrl = baseUrl;
    this.maxRetries = 3;
    this.retryDelay = 500; // ms
  }

  /**
   * Load network data with retry logic
   * @param {string} filename - JSON filename (default: 'network.json')
   * @returns {Promise<Object>} Parsed network data
   */
  async loadNetworkData(filename = 'network.json') {
    const url = `${this.baseUrl}${filename}`;
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        appState.setLoadMessage(`Loading data (attempt ${attempt}/${this.maxRetries})...`);

        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          cache: 'no-cache'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error(`Invalid content type: ${contentType || 'unknown'}`);
        }

        const data = await response.json();

        // Validate structure
        if (!data.manholes || !Array.isArray(data.manholes)) {
          throw new Error('Invalid data: missing or malformed "manholes" array');
        }
        if (!data.pipes || !Array.isArray(data.pipes)) {
          throw new Error('Invalid data: missing or malformed "pipes" array');
        }
        if (!data.metadata) {
          console.warn('DataLoader: missing metadata, using defaults');
          data.metadata = this.getDefaultMetadata();
        }

        appState.setNetworkData(data);

        const validationIssues = appState.validateData();
        if (validationIssues.length > 0) {
          console.warn('DataLoader: validation warnings:', validationIssues);
          validationIssues.forEach(issue => 
            appState.addError(issue, 'DataLoader.validation')
          );
        }

        return data;

      } catch (error) {
        lastError = error;
        appState.addError(
          `Attempt ${attempt} failed: ${error.message}`, 
          'DataLoader.fetch'
        );

        if (attempt < this.maxRetries) {
          appState.setLoadMessage(`Retrying in ${this.retryDelay}ms...`);
          await this.delay(this.retryDelay * attempt); // Exponential backoff
        }
      }
    }

    // All retries exhausted
    throw new Error(`Failed to load data after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Load basemap texture with error handling
   * @param {string} filename - Image filename
   * @returns {Promise<HTMLImageElement>} Loaded image
   */
  async loadBasemapImage(filename = 'basemap.png') {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = () => {
        const error = new Error(`Failed to load basemap image: ${filename}`);
        appState.addError(error.message, 'DataLoader.image');
        reject(error);
      };

      // Set crossOrigin for CORS if needed
      img.crossOrigin = 'anonymous';
      img.src = `${this.baseUrl}${filename}`;

      // Timeout fallback
      setTimeout(() => {
        if (!img.complete) {
          const error = new Error(`Basemap image load timeout: ${filename}`);
          appState.addError(error.message, 'DataLoader.image');
          reject(error);
        }
      }, 10000);
    });
  }

  /**
   * Load manhole images with graceful fallback
   * @param {string[]} imagePaths - Array of image paths
   * @returns {Promise<string[]>} Valid image paths
   */
  async validateImagePaths(imagePaths) {
    if (!imagePaths || imagePaths.length === 0) return [];

    const validPaths = [];

    await Promise.all(
      imagePaths.map(async (path) => {
        try {
          const response = await fetch(path, { method: 'HEAD', cache: 'no-cache' });
          if (response.ok) {
            validPaths.push(path);
          } else {
            appState.addError(
              `Image not found: ${path} (${response.status})`, 
              'DataLoader.image'
            );
          }
        } catch (error) {
          appState.addError(
            `Image check failed: ${path} — ${error.message}`, 
            'DataLoader.image'
          );
        }
      })
    );

    return validPaths;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getDefaultMetadata() {
    return {
      project: 'Unknown Network',
      crs: 'survey',
      basemap_elev: 1546.83,
      rotate_180: true,
      basemap_bounds: {
        left: -97791.36,
        right: -97133.03,
        bottom: 2891253.79,
        top: 2891979.14
      }
    };
  }
}

export const dataLoader = new DataLoader();
