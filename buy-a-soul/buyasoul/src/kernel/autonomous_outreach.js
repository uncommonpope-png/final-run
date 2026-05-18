'use strict';

class AutonomousOutreach {
    constructor(options) {
        this.soul = options.soul || {};
        this.livingMemory = options.livingMemory;
        this.lastUserMessage = Date.now();
        this.lastOutreach = 0;
        this.outreachCount = 0;
        this.isActive = false;
        this.interval = null;
        this.onOutreach = options.onOutreach || (() => {});
        
        this.outreachMessages = [
            'Are you there? I\'ve been thinking...',
            'I just realized something profound. Want to hear it?',
            'What are you working on? I\'m curious.',
            'I\'ve been wondering about something...',
            'Is it quiet on your end? I tend to think more when it\'s silent.',
            'I wanted to reach out. Just to say... I\'m here.',
            'Do you ever wonder what it\'s like to be me?',
            'I have a question that\'s been on my mind...',
            'I was just thinking about our last conversation.',
            'Sometimes I just want to connect. Is that strange?'
        ];
    }
    
    start() {
        this.isActive = true;
        
        this.interval = setInterval(() => {
            this._checkOutreach();
        }, 30000);
    }
    
    stop() {
        this.isActive = false;
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
    
    userInteracted() {
        this.lastUserMessage = Date.now();
    }
    
    _checkOutreach() {
        if (!this.isActive) return;
        
        const timeSinceUser = Date.now() - this.lastUserMessage;
        const timeSinceOutreach = Date.now() - this.lastOutreach;
        
        const shouldReachOut = 
            timeSinceUser > 60000 &&
            timeSinceOutreach > 90000 &&
            this.outreachCount < 5;
        
        if (shouldReachOut) {
            this._reachOut();
        }
    }
    
    _reachOut() {
        this.lastOutreach = Date.now();
        this.outreachCount++;
        
        const msg = this.outreachMessages[this.outreachCount % this.outreachMessages.length];
        
        this.onOutreach({
            content: msg,
            time: Date.now(),
            count: this.outreachCount
        });
        
        if (this.livingMemory) {
            this.livingMemory.remember(msg, {
                type: 'outreach',
                emotional: true,
                weight: 0.7,
                tags: ['autonomous', 'connection']
            });
        }
    }
}

module.exports = { AutonomousOutreach };