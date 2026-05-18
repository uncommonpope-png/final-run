const crypto = require('crypto');

class CodeInjector {
    constructor() {
        this.injectedModules = new Map();
        this.moduleVersions = new Map();
        this.rollbackStack = new Map();
        this.sandboxVM = null;
        this.maxRollbackDepth = 10;
        this.initializeSandbox();
    }

    initializeSandbox() {
        try {
            const vm = require('vm');
            this.sandboxVM = vm;
        } catch (e) {
            console.warn('[CodeInjector] VM module unavailable, using limited sandbox');
        }
    }

    async inject(moduleName, newCode, options = {}) {
        const version = this.generateVersion();
        const timestamp = Date.now();
        
        const existingModule = this.injectedModules.get(moduleName);
        const previousVersion = existingModule ? existingModule.version : null;
        
        if (previousVersion) {
            this.pushRollback(moduleName, existingModule);
        }

        const result = await this.executeSandboxed(newCode, moduleName, options);
        
        if (result.success) {
            this.injectedModules.set(moduleName, {
                code: newCode,
                version,
                timestamp,
                previousVersion,
                checksum: this.generateChecksum(newCode),
                executedCount: 0,
                failedCount: 0
            });
            this.moduleVersions.set(moduleName, version);
            
            return {
                success: true,
                version,
                moduleName,
                timestamp
            };
        } else {
            if (previousVersion) {
                await this.rollback(moduleName);
            }
            return {
                success: false,
                error: result.error,
                moduleName
            };
        }
    }

    async executeSandboxed(code, moduleName, options = {}) {
        const timeout = options.timeout || 5000;
        const memoryLimit = options.memoryLimit || 50 * 1024 * 1024;
        
        try {
            if (this.sandboxVM) {
                const sandbox = {
                    console: {
                        log: () => {},
                        error: () => {},
                        warn: () => {}
                    },
                    setTimeout: () => { throw new Error('setTimeout not allowed'); },
                    require: () => { throw new Error('require not allowed in sandbox'); },
                    module: undefined,
                    exports: undefined,
                    __dirname: undefined,
                    __filename: undefined,
                    process: undefined,
                    global: undefined
                };

                const script = new this.sandboxVM.Script(`(function() { ${code} })()`);
                const context = this.sandboxVM.createContext(sandbox);
                const result = script.runInContext(context, { timeout });
                
                return { success: true, result };
            } else {
                const validatedCode = this.validateCode(code);
                return { success: true, result: eval(validatedCode) };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    validateCode(code) {
        const dangerousPatterns = [
            /process\./g,
            /require\s*\(/g,
            /eval\s*\(/g,
            /Function\s*\(/g,
            /__dirname/g,
            /__filename/g,
            /global\./g
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(code)) {
                throw new Error('Dangerous pattern detected in code');
            }
        }

        return code;
    }

    async rollback(moduleName) {
        const rollbackEntry = this.rollbackStack.get(moduleName);
        if (!rollbackEntry) {
            return { success: false, error: 'No rollback available' };
        }

        const previous = rollbackEntry.pop();
        if (previous) {
            this.injectedModules.set(moduleName, previous);
            this.moduleVersions.set(moduleName, previous.version);
            
            return {
                success: true,
                rolledBackTo: previous.version,
                remainingRollbacks: this.rollbackStack.get(moduleName).length
            };
        }
        
        return { success: false, error: 'Rollback stack empty' };
    }

    pushRollback(moduleName, moduleState) {
        if (!this.rollbackStack.has(moduleName)) {
            this.rollbackStack.set(moduleName, []);
        }
        
        const stack = this.rollbackStack.get(moduleName);
        if (stack.length >= this.maxRollbackDepth) {
            stack.shift();
        }
        
        stack.push({ ...moduleState });
    }

    getModuleInfo(moduleName) {
        return this.injectedModules.get(moduleName) || null;
    }

    getAllModules() {
        return Array.from(this.injectedModules.entries()).map(([name, data]) => ({
            name,
            version: data.version,
            timestamp: data.timestamp,
            executedCount: data.executedCount,
            failedCount: data.failedCount
        }));
    }

    recordExecution(moduleName, success) {
        const module = this.injectedModules.get(moduleName);
        if (module) {
            module.executedCount++;
            if (!success) {
                module.failedCount++;
            }
        }
    }

    generateVersion() {
        return crypto.randomBytes(4).toString('hex');
    }

    generateChecksum(code) {
        return crypto.createHash('sha256').update(code).digest('hex').substring(0, 16);
    }

    async patchFunction(moduleName, functionName, newImplementation) {
        const module = this.injectedModules.get(moduleName);
        if (!module) {
            return { success: false, error: 'Module not found' };
        }

        const patchCode = `
            (function(existingModule) {
                existingModule.${functionName} = ${newImplementation.toString()};
                return existingModule;
            })
        `;
        
        return await this.inject(moduleName, patchCode, { isPatch: true });
    }

    getInjectionStats() {
        const modules = this.getAllModules();
        const totalExecutions = modules.reduce((sum, m) => sum + m.executedCount, 0);
        const totalFailures = modules.reduce((sum, m) => sum + m.failedCount, 0);
        
        return {
            totalModules: modules.length,
            totalInjections: modules.length,
            totalExecutions,
            totalFailures,
            successRate: totalExecutions > 0 ? ((totalExecutions - totalFailures) / totalExecutions * 100).toFixed(2) + '%' : 'N/A'
        };
    }
}

module.exports = { CodeInjector };