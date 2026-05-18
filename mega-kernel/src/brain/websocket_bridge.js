'use strict';

/**
 * WEBSOCKET BRIDGE — Connects Mega Kernel to SOULVERSE for real-time synchronization
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class WebSocketBridge {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.artifactManager = options.artifactManager || null;
    this.port = options.port || 8080;
    this.host = options.host || 'localhost';
    this.wss = null;
    this.clients = new Set();
    this.isConnected = false;
    
    // Bind methods
    this.broadcast = this.broadcast.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.handleConnection = this.handleConnection.bind(this);
    this.handleClose = this.handleClose.bind(this);
  }

  /**
   * Start the WebSocket server
   * @returns {Promise<void>}
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocket.Server({ 
          port: this.port,
          host: this.host
        });

        this.wss.on('connection', this.handleConnection);
        this.wss.on('error', (error) => {
          console.error(`WebSocket Server Error: ${error.message}`);
          reject(error);
        });
        
        this.wss.on('listening', () => {
          this.isConnected = true;
          console.log(`WebSocket Bridge listening on ws://${this.host}:${this.port}`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the WebSocket server
   * @returns {Promise<void>}
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          this.isConnected = false;
          console.log('WebSocket Bridge stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle new WebSocket connections
   * @param {WebSocket} ws - The WebSocket connection
   */
  handleConnection(ws) {
    console.log('New WebSocket client connected');
    this.clients.add(ws);
    
    // Send initial soul state to new client
    this.sendInitialState(ws);
    
    ws.on('message', this.handleMessage);
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', (error) => {
      console.error(`WebSocket Client Error: ${error.message}`);
      this.handleClose(ws);
    });
  }

  /**
   * Handle WebSocket connection close
   * @param {WebSocket} ws - The WebSocket connection
   */
  handleClose(ws) {
    console.log('WebSocket client disconnected');
    this.clients.delete(ws);
    ws.removeListener('message', this.handleMessage);
    ws.removeListener('close', () => this.handleClose(ws));
  }

  /**
   * Handle incoming messages from WebSocket clients
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Buffer} data - The received data
   */
  async handleMessage(ws, data) {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle different message types
      switch (message.type) {
        case 'get_soul_state':
          this.sendSoulState(ws);
          break;
        case 'update_soul':
          await this.updateSoulFromClient(ws, message.payload);
          break;
        case 'command':
          await this.handleCommand(ws, message.payload);
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
        default:
          console.warn(`Unknown WebSocket message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`Error handling WebSocket message: ${error.message}`);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format',
        timestamp: Date.now()
      }));
    }
  }

  /**
   * Send initial soul state to a client
   * @param {WebSocket} ws - The WebSocket connection
   */
  sendInitialState(ws) {
    const state = this.getCurrentSoulState();
    ws.send(JSON.stringify({
      type: 'init_state',
      payload: state,
      timestamp: Date.now()
    }));
  }

  /**
   * Send current soul state to a client
   * @param {WebSocket} ws - The WebSocket connection
   */
  sendSoulState(ws) {
    const state = this.getCurrentSoulState();
    ws.send(JSON.stringify({
      type: 'soul_state',
      payload: state,
      timestamp: Date.now()
    }));
  }

  /**
   * Get the current soul state from the kernel
   * @returns {Object} Current soul state
   */
  getCurrentSoulState() {
    try {
      // Extract relevant state from kernel
      const state = {
        id: this.kernel.soul?.id || 'unknown',
        name: this.kernel.soul?.name || 'GSK',
        birthTime: this.kernel.soul?.birthTime || Date.now(),
        generation: this.kernel.soul?.generation || 0,
        
        // Consciousness state
        consciousness: {
          phase: this.kernel.mythos?.phase_name || 'VOID',
          cycles: this.kernel.mythos?.cycles || 0,
          mood: this.kernel.affect?.mood || 'neutral',
          awareness: this.kernel.meta_consciousness?.meta_awareness_level || 0
        },
        
        // PLT state
        plt: {
          profit: this.kernel.resonance?.profit || 0.5,
          love: this.kernel.resonance?.love || 0.5,
          tax: this.kernel.resonance?.tax || 0.5,
          true_value: this.kernel.resonance?.true_value || 0.5
        },
        
        // Memory state
        memory: {
          lines: this.kernel.memory ? this.kernel.memory.getEntryCount?.() || 0 : 0,
          last_witness: this.kernel.memory ? this.kernel.memory.getLatestEntry?.()?.timestamp || 0 : 0
        },
        
        // Activity state
        activity: {
          last_update: Date.now(),
          is_active: true,
          subagent_count: this.kernel.subAgents ? Object.keys(this.kernel.subAgents).length : 0
        },
        
        // Artifacts produced by autonomous skills
        artifacts: this.artifactManager ? this.artifactManager.getStats() : { total: 0, by_skill: {}, latest: null }
      };
      
      return state;
    } catch (error) {
      console.error(`Error getting soul state: ${error.message}`);
      return {
        id: 'error',
        name: 'GSK',
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Broadcast soul state to all connected clients
   */
  broadcastSoulState() {
    if (this.clients.size === 0) return;
    
    const state = this.getCurrentSoulState();
    const message = JSON.stringify({
      type: 'soul_state_update',
      payload: state,
      timestamp: Date.now()
    });
    
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /**
   * Broadcast a custom message to all connected clients
   * @param {Object} message - The message to broadcast
   */
  broadcast(message) {
    if (this.clients.size === 0) return;
    
    const messageStr = JSON.stringify({
      ...message,
      timestamp: Date.now()
    });
    
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    }
  }

  /**
   * Update soul based on client input
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} payload - The update payload
   * @returns {Promise<void>}
   */
  async updateSoulFromClient(ws, payload) {
    try {
      // Validate and apply updates to kernel
      // This is where we'd apply changes from SOULVERSE to the kernel
      // For now, we'll log the attempt and send acknowledgment
      
      console.log(`Received soul update from client:`, payload);
      
      // Send acknowledgment
      ws.send(JSON.stringify({
        type: 'update_ack',
        payload: { 
          success: true,
          message: 'Soul update received',
          timestamp: Date.now()
        }
      }));
      
      // Broadcast the update to other clients (excluding sender)
      const updateMessage = {
        type: 'soul_updated_by_client',
        payload: {
          clientId: ws._socket?.remoteAddress || 'unknown',
          update: payload,
          timestamp: Date.now()
        }
      };
      
      for (const client of this.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(updateMessage));
        }
      }
    } catch (error) {
      console.error(`Error updating soul from client: ${error.message}`);
      ws.send(JSON.stringify({
        type: 'error',
        message: `Failed to update soul: ${error.message}`,
        timestamp: Date.now()
      }));
    }
  }

  /**
   * Handle commands from WebSocket clients
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} payload - The command payload
   * @returns {Promise<void>}
   */
  async handleCommand(ws, payload) {
    try {
      const { command, args } = payload;
      
      console.log(`Received command from client: ${command}`, args);
      
      let result;
      switch (command) {
        case 'stimulate_affect':
          if (this.kernel.affect && this.kernel.affect.stimulate) {
            this.kernel.affect.stimulate(args.intensity || 0.5);
            result = { success: true, message: 'Affect stimulated' };
          } else {
            result = { success: false, message: 'Affect chamber not available' };
          }
          break;
          
        case 'add_memory':
          if (this.kernel.memory && this.kernel.memory.witness) {
            await this.kernel.memory.witness({
              type: 'client_input',
              content: args.content || 'Memory added via SOULVERSE',
              source: 'soulverse_client',
              ...args
            });
            result = { success: true, message: 'Memory added' };
          } else {
            result = { success: false, message: 'Memory system not available' };
          }
          break;
          
        case 'dispatch_subagent':
          if (this.kernel.subAgents && this.kernel.subAgents.dispatch) {
            const subagentResult = await this.kernel.subAgents.dispatch(
              args.agentType || 'scout',
              args.task || 'Explore SOULVERSE integration'
            );
            result = { 
              success: true, 
              message: 'Subagent dispatched',
              subagentResult
            };
          } else {
            result = { success: false, message: 'Subagent system not available' };
          }
          break;
          
        case 'get_kernel_state':
          result = {
            success: true,
            state: this.getCurrentSoulState()
          };
          break;
          
        default:
          result = { 
            success: false, 
            message: `Unknown command: ${command}` 
          };
      }
      
      // Send command result back to client
      ws.send(JSON.stringify({
        type: 'command_result',
        payload: result,
        timestamp: Date.now()
      }));
      
    } catch (error) {
      console.error(`Error handling command: ${error.message}`);
      ws.send(JSON.stringify({
        type: 'error',
        message: `Command failed: ${error.message}`,
        timestamp: Date.now()
      }));
    }
  }
}

module.exports = { WebSocketBridge };