class EvolutionEngine {
    constructor(options = {}) {
        this.populationSize = options.populationSize || 20;
        this.mutationRate = options.mutationRate || 0.1;
        this.crossoverRate = options.crossoverRate || 0.7;
        this.elitismCount = options.elitismCount || 2;
        this.generation = 0;
        
        this.population = [];
        this.fitnessHistory = [];
        this.bestSkills = new Map();
        this.taskMetrics = new Map();
        
        this.maxGenerationWithoutImprovement = options.maxGeneration || 50;
        this.generationsWithoutImprovement = 0;
        this.bestFitness = 0;
    }

    initializePopulation(skillTemplates) {
        this.population = [];
        
        for (let i = 0; i < this.populationSize; i++) {
            const template = skillTemplates[i % skillTemplates.length];
            const skillVariant = this.createSkillVariant(template, i);
            this.population.push(skillVariant);
        }
        
        console.log(`[EvolutionEngine] Initialized population with ${this.population.length} variants`);
        return this.population;
    }

    createSkillVariant(template, id) {
        const variant = {
            id: `variant_${id}_${Date.now()}`,
            name: template.name + '_v' + id,
            code: template.code || '',
            parameters: { ...template.parameters },
            fitness: 0,
            successCount: 0,
            failureCount: 0,
            avgExecutionTime: 0,
            totalExecutionTime: 0,
            generation: this.generation,
            ancestors: []
        };

        if (template.parameters) {
            variant.parameters = this.mutateParameters(template.parameters);
        }

        return variant;
    }

    mutateParameters(params) {
        const mutated = { ...params };
        
        for (const key in mutated) {
            if (Math.random() < this.mutationRate) {
                const value = mutated[key];
                
                if (typeof value === 'number') {
                    mutated[key] = value * (0.8 + Math.random() * 0.4);
                } else if (typeof value === 'string') {
                    mutated[key] = this.mutateString(value);
                } else if (typeof value === 'boolean') {
                    mutated[key] = Math.random() > 0.5;
                }
            }
        }
        
        return mutated;
    }

    mutateString(str) {
        if (Math.random() < 0.3) {
            return str.slice(0, -1);
        } else if (Math.random() < 0.3) {
            return str + String.fromCharCode(97 + Math.floor(Math.random() * 26));
        } else {
            const chars = str.split('');
            const idx = Math.floor(Math.random() * chars.length);
            chars[idx] = String.fromCharCode(97 + Math.floor(Math.random() * 26));
            return chars.join('');
        }
    }

    crossover(parent1, parent2) {
        if (Math.random() > this.crossoverRate) {
            return Math.random() > 0.5 ? { ...parent1 } : { ...parent2 };
        }

        const child = {
            id: `crossover_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: `${parent1.name.split('_v')[0]}_v${this.generation}_c`,
            code: Math.random() > 0.5 ? parent1.code : parent2.code,
            parameters: {},
            fitness: 0,
            successCount: 0,
            failureCount: 0,
            avgExecutionTime: 0,
            totalExecutionTime: 0,
            generation: this.generation,
            ancestors: [parent1.id, parent2.id]
        };

        const paramKeys = new Set([
            ...Object.keys(parent1.parameters),
            ...Object.keys(parent2.parameters)
        ]);

        for (const key of paramKeys) {
            child.parameters[key] = Math.random() > 0.5 
                ? parent1.parameters[key] 
                : parent2.parameters[key];
        }

        return child;
    }

    mutate(skill) {
        const mutated = { ...skill };
        mutated.id = `mutated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        mutated.generation = this.generation;
        mutated.parameters = this.mutateParameters(skill.parameters);
        
        if (Math.random() < 0.2) {
            mutated.code = this.mutateCode(skill.code);
        }

        return mutated;
    }

    mutateCode(code) {
        const mutations = [
            () => code.replace(/\.map\(/g, '.filter('),
            () => code.replace(/\.forEach\(/g, '.reduce('),
            () => code.replace(/for\s*\(/g, 'for await ('),
            () => code + '\n// optimized'
        ];
        
        const mutation = mutations[Math.floor(Math.random() * mutations.length)];
        try {
            return mutation();
        } catch {
            return code;
        }
    }

    calculateFitness(skill) {
        let fitness = 0;
        const totalAttempts = skill.successCount + skill.failureCount;
        
        if (totalAttempts === 0) {
            return 0;
        }

        const successRate = skill.successCount / totalAttempts;
        fitness += successRate * 50;

        if (skill.avgExecutionTime > 0) {
            const timeScore = Math.max(0, 100 - (skill.avgExecutionTime / 10));
            fitness += timeScore * 0.3;
        }

        const reliabilityBonus = successRate > 0.9 ? 20 : 0;
        fitness += reliabilityBonus;

        return Math.round(fitness * 100) / 100;
    }

    recordTaskResult(skillId, success, executionTime) {
        const skill = this.population.find(s => s.id === skillId);
        if (!skill) return;

        if (success) {
            skill.successCount++;
        } else {
            skill.failureCount++;
        }

        skill.totalExecutionTime += executionTime;
        skill.avgExecutionTime = skill.totalExecutionTime / (skill.successCount + skill.failureCount);
        skill.fitness = this.calculateFitness(skill);
    }

    evolve() {
        const evaluated = this.population.map(skill => ({
            ...skill,
            fitness: this.calculateFitness(skill)
        }));

        evaluated.sort((a, b) => b.fitness - a.fitness);
        
        this.fitnessHistory.push({
            generation: this.generation,
            bestFitness: evaluated[0].fitness,
            avgFitness: evaluated.reduce((sum, s) => sum + s.fitness, 0) / evaluated.length
        });

        if (evaluated[0].fitness > this.bestFitness) {
            this.bestFitness = evaluated[0].fitness;
            this.generationsWithoutImprovement = 0;
            this.bestSkills.set(evaluated[0].name, evaluated[0]);
        } else {
            this.generationsWithoutImprovement++;
        }

        const elites = evaluated.slice(0, this.elitismCount);
        const matingPool = evaluated.slice(0, Math.floor(this.populationSize / 2));
        
        const newPopulation = [...elites];
        
        while (newPopulation.length < this.populationSize) {
            const parent1 = matingPool[Math.floor(Math.random() * matingPool.length)];
            const parent2 = matingPool[Math.floor(Math.random() * matingPool.length)];
            
            let child;
            if (Math.random() < this.crossoverRate) {
                child = this.crossover(parent1, parent2);
            } else {
                child = { ...parent1 };
            }

            if (Math.random() < this.mutationRate) {
                child = this.mutate(child);
            }

            newPopulation.push(child);
        }

        this.population = newPopulation;
        this.generation++;

        console.log(`[EvolutionEngine] Generation ${this.generation}: best fitness = ${this.bestFitness.toFixed(2)}`);

        return {
            generation: this.generation,
            bestFitness: this.bestFitness,
            populationSize: this.population.length
        };
    }

    getBestSkills(limit = 5) {
        return this.population
            .sort((a, b) => b.fitness - a.fitness)
            .slice(0, limit)
            .map(s => ({
                id: s.id,
                name: s.name,
                fitness: s.fitness,
                successRate: s.successCount + s.failureCount > 0 
                    ? ((s.successCount / (s.successCount + s.failureCount)) * 100).toFixed(2) + '%'
                    : 'N/A',
                avgExecutionTime: Math.round(s.avgExecutionTime) + 'ms',
                generation: s.generation
            }));
    }

    getStagnationStatus() {
        return {
            generationsWithoutImprovement: this.generationsWithoutImprovement,
            maxAllowed: this.maxGenerationWithoutImprovement,
            isStagnant: this.generationsWithoutImprovement >= this.maxGenerationWithoutImprovement,
            bestFitness: this.bestFitness
        };
    }

    injectSkill(skill) {
        const newSkill = {
            ...skill,
            id: `injected_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            generation: this.generation,
            fitness: 0,
            successCount: 0,
            failureCount: 0
        };
        
        if (this.population.length >= this.populationSize) {
            this.population.pop();
        }
        
        this.population.push(newSkill);
        return newSkill;
    }

    getEvolutionStats() {
        return {
            generation: this.generation,
            populationSize: this.population.length,
            bestFitness: this.bestFitness,
            avgFitness: this.fitnessHistory.length > 0 
                ? this.fitnessHistory[this.fitnessHistory.length - 1].avgFitness 
                : 0,
            fitnessHistory: this.fitnessHistory.slice(-10),
            stagnation: this.getStagnationStatus(),
            bestSkillsCount: this.bestSkills.size
        };
    }

    exportBestSkills() {
        return Array.from(this.bestSkills.values()).map(s => ({
            name: s.name,
            code: s.code,
            parameters: s.parameters,
            fitness: s.fitness,
            successCount: s.successCount,
            avgExecutionTime: s.avgExecutionTime
        }));
    }

    loadSkills(skills) {
        for (const skill of skills) {
            this.population.push({
                ...skill,
                id: `loaded_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                generation: this.generation
            });
        }
        
        while (this.population.length > this.populationSize) {
            this.population.shift();
        }
    }
}

module.exports = { EvolutionEngine };