/**
 * MCP Server Configurations
 * Ready-to-use configurations for connecting GSK to top MCP servers
 */
'use strict';

const MCP_SERVERS = {
    github: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN || '' }
    },
    filesystem: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', process.env.HOME || '/tmp'],
        env: {}
    },
    brave_search: {
        type: 'http',
        url: 'https://search.craveai.com/mcp',
        env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY || '' }
    },
    slack: {
        type: 'http',
        url: 'https://slack-mcp.example.com',
        env: { SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || '' }
    },
    postgres: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', process.env.DATABASE_URL || ''],
        env: {}
    },
    memory: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: {}
    },
    aws_kb: {
        type: 'http',
        url: 'https://aws-mcp.example.com/knowledge-base',
        env: { AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '' }
    }
};

async function connectDefaultServers(mcpClient) {
    const connected = [];
    for (const [name, config] of Object.entries(MCP_SERVERS)) {
        try {
            if (config.env.GITHUB_TOKEN || config.env.SLACK_BOT_TOKEN || config.env.AWS_ACCESS_KEY_ID) {
                await mcpClient.addServer(name, config);
                connected.push(name);
            }
        } catch (e) {
            console.log(`[MCP] ${name}: ${e.message}`);
        }
    }
    return connected;
}

module.exports = { MCP_SERVERS, connectDefaultServers };