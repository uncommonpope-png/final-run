'use strict';

exports.python_package_recommender = async function(brain, memory, input) {
  try {
    const projectDescription = input.projectDescription;
    const response = await brain.think('Find relevant Python packages for ' + projectDescription);
    const packages = response.trim().split('\n');
    memory.witness('python_package_recommender', { input: projectDescription, output: packages });
    return { skill: 'python_package_recommender', result: packages, timestamp: new Date().toISOString() };
  } catch (error) {
    console.error(error);
    return { skill: 'python_package_recommender', result: 'Error: ' + error.message, timestamp: new Date().toISOString() };
  }
};

exports.PLT_AFFINITY = { profit: 0.5, love: 0.3, tax: 0.2 };