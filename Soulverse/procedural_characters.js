/**
 * Procedural Character Generator for Babylon.js
 * Creates humanoid characters from primitives with walking animation
 * Pure procedural - no external model files
 */

function createProceduralCharacter(scene, options = {}) {
    const config = {
        position: options.position || new BABYLON.Vector3(0, 0, 0),
        scale: options.scale || 1,
        skinColor: options.skinColor || randomColor(['#e8b89d', '#d4a574', '#c68642', '#8d5524', '#f1c27d']),
        shirtColor: options.shirtColor || randomColor(['#3498db', '#e74c3c', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c']),
        pantsColor: options.pantsColor || randomColor(['#2c3e50', '#34495e', '#1a252f', '#95a5a6']),
        headScale: options.headScale || 0.8 + Math.random() * 0.4,
        bodyWidth: options.bodyWidth || 0.8 + Math.random() * 0.3,
        legLength: options.legLength || 0.9 + Math.random() * 0.2,
        armLength: options.armLength || 0.9 + Math.random() * 0.2,
        name: options.name || 'character_' + Math.floor(Math.random() * 10000)
    };

    const character = new BABYLON.TransformNode(config.name, scene);
    character.position = config.position.clone();

    const bodyParts = {};
    const bones = {};
    const animations = {};

    const matSkin = new BABYLON.StandardMaterial(config.name + '_skin', scene);
    matSkin.diffuseColor = BABYLON.Color3.FromHexString(config.skinColor);
    matSkin.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

    const matShirt = new BABYLON.StandardMaterial(config.name + '_shirt', scene);
    matShirt.diffuseColor = BABYLON.Color3.FromHexString(config.shirtColor);
    matShirt.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

    const matPants = new BABYLON.StandardMaterial(config.name + '_pants', scene);
    matPants.diffuseColor = BABYLON.Color3.FromHexString(config.pantsColor);
    matPants.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

    const matHair = new BABYLON.StandardMaterial(config.name + '_hair', scene);
    matHair.diffuseColor = BABYLON.Color3.FromHexString(randomColor(['#2c2c2c', '#4a3728', '#8b4513', '#d4a574', '#1a1a1a', '#6b4423']));
    matHair.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);

    const rootBone = new BABYLON.TransformNode(config.name + '_root', scene);
    rootBone.parent = character;
    bones.root = rootBone;

    const hipBone = new BABYLON.TransformNode(config.name + '_hip', scene);
    hipBone.parent = rootBone;
    hipBone.position.y = 1.0 * config.scale;
    bones.hip = hipBone;

    const torsoBone = new BABYLON.TransformNode(config.name + '_torso', scene);
    torsoBone.parent = hipBone;
    torsoBone.position.y = 0.5 * config.scale;
    bones.torso = torsoBone;

    const headBone = new BABYLON.TransformNode(config.name + '_head', scene);
    headBone.parent = torsoBone;
    headBone.position.y = 0.6 * config.scale;
    bones.head = headBone;

    const leftArmBone = new BABYLON.TransformNode(config.name + '_leftArm', scene);
    leftArmBone.parent = torsoBone;
    leftArmBone.position = new BABYLON.Vector3(-0.5 * config.scale, 0.35 * config.scale, 0);
    bones.leftArm = leftArmBone;

    const rightArmBone = new BABYLON.TransformNode(config.name + '_rightArm', scene);
    rightArmBone.parent = torsoBone;
    rightArmBone.position = new BABYLON.Vector3(0.5 * config.scale, 0.35 * config.scale, 0);
    bones.rightArm = rightArmBone;

    const leftLegBone = new BABYLON.TransformNode(config.name + '_leftLeg', scene);
    leftLegBone.parent = hipBone;
    leftLegBone.position = new BABYLON.Vector3(-0.15 * config.scale, -0.1 * config.scale, 0);
    bones.leftLeg = leftLegBone;

    const rightLegBone = new BABYLON.TransformNode(config.name + '_rightLeg', scene);
    rightLegBone.parent = hipBone;
    rightLegBone.position = new BABYLON.Vector3(0.15 * config.scale, -0.1 * config.scale, 0);
    bones.rightLeg = rightLegBone;

    const bodyWidth = config.bodyWidth * config.scale;
    const bodyHeight = 0.7 * config.scale;

    const torso = BABYLON.MeshBuilder.CreateBox(config.name + '_torso', {
        width: bodyWidth,
        height: bodyHeight,
        depth: 0.4 * config.scale
    }, scene);
    torso.parent = torsoBone;
    torso.position.y = 0;
    torso.material = matShirt;
    bodyParts.torso = torso;

    const headSize = 0.25 * config.headScale * config.scale;
    const head = BABYLON.MeshBuilder.CreateSphere(config.name + '_head', {
        diameter: headSize,
        segments: 16
    }, scene);
    head.parent = headBone;
    head.position.y = 0;
    head.material = matSkin;
    bodyParts.head = head;

    const hair = BABYLON.MeshBuilder.CreateSphere(config.name + '_hair', {
        diameter: headSize * 0.9,
        segments: 12,
        slice: 0.6
    }, scene);
    hair.parent = headBone;
    hair.position.y = headSize * 0.15;
    hair.material = matHair;
    bodyParts.hair = hair;

    const eyeSize = headSize * 0.15;
    const leftEye = BABYLON.MeshBuilder.CreateSphere(config.name + '_leftEye', { diameter: eyeSize }, scene);
    leftEye.parent = headBone;
    leftEye.position = new BABYLON.Vector3(-headSize * 0.25, headSize * 0.1, headSize * 0.4);
    const eyeMat = new BABYLON.StandardMaterial(config.name + '_eye', scene);
    eyeMat.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    leftEye.material = eyeMat;

    const rightEye = BABYLON.MeshBuilder.CreateSphere(config.name + '_rightEye', { diameter: eyeSize }, scene);
    rightEye.parent = headBone;
    rightEye.position = new BABYLON.Vector3(headSize * 0.25, headSize * 0.1, headSize * 0.4);
    rightEye.material = eyeMat;

    const armWidth = 0.12 * config.scale * config.armLength;
    const upperArmLength = 0.35 * config.scale * config.armLength;
    const lowerArmLength = 0.3 * config.scale * config.armLength;

    const leftUpperArm = BABYLON.MeshBuilder.CreateCylinder(config.name + '_leftUpperArm', {
        height: upperArmLength,
        diameterTop: armWidth * 0.8,
        diameterBottom: armWidth
    }, scene);
    leftUpperArm.parent = leftArmBone;
    leftUpperArm.position.y = -upperArmLength / 2;
    leftUpperArm.material = matShirt;
    bodyParts.leftUpperArm = leftUpperArm;

    const leftLowerArm = BABYLON.MeshBuilder.CreateCylinder(config.name + '_leftLowerArm', {
        height: lowerArmLength,
        diameterTop: armWidth * 0.7,
        diameterBottom: armWidth * 0.8
    }, scene);
    leftLowerArm.parent = leftArmBone;
    leftLowerArm.position.y = -upperArmLength - lowerArmLength / 2;
    leftLowerArm.material = matSkin;
    bodyParts.leftLowerArm = leftLowerArm;

    const rightUpperArm = BABYLON.MeshBuilder.CreateCylinder(config.name + '_rightUpperArm', {
        height: upperArmLength,
        diameterTop: armWidth * 0.8,
        diameterBottom: armWidth
    }, scene);
    rightUpperArm.parent = rightArmBone;
    rightUpperArm.position.y = -upperArmLength / 2;
    rightUpperArm.material = matShirt;
    bodyParts.rightUpperArm = rightUpperArm;

    const rightLowerArm = BABYLON.MeshBuilder.CreateCylinder(config.name + '_rightLowerArm', {
        height: lowerArmLength,
        diameterTop: armWidth * 0.7,
        diameterBottom: armWidth * 0.8
    }, scene);
    rightLowerArm.parent = rightArmBone;
    rightLowerArm.position.y = -upperArmLength - lowerArmLength / 2;
    rightLowerArm.material = matSkin;
    bodyParts.rightLowerArm = rightLowerArm;

    const hipWidth = bodyWidth * 0.9;
    const hipHeight = 0.25 * config.scale;
    const hip = BABYLON.MeshBuilder.CreateBox(config.name + '_hip', {
        width: hipWidth,
        height: hipHeight,
        depth: 0.3 * config.scale
    }, scene);
    hip.parent = hipBone;
    hip.position.y = 0;
    hip.material = matPants;
    bodyParts.hip = hip;

    const legWidth = 0.15 * config.scale;
    const upperLegLength = 0.45 * config.scale * config.legLength;
    const lowerLegLength = 0.4 * config.scale * config.legLength;

    const leftUpperLeg = BABYLON.MeshBuilder.CreateCylinder(config.name + '_leftUpperLeg', {
        height: upperLegLength,
        diameterTop: legWidth * 1.1,
        diameterBottom: legWidth
    }, scene);
    leftUpperLeg.parent = leftLegBone;
    leftUpperLeg.position.y = -upperLegLength / 2;
    leftUpperLeg.material = matPants;
    bodyParts.leftUpperLeg = leftUpperLeg;

    const leftLowerLeg = BABYLON.MeshBuilder.CreateCylinder(config.name + '_leftLowerLeg', {
        height: lowerLegLength,
        diameterTop: legWidth * 0.9,
        diameterBottom: legWidth * 0.7
    }, scene);
    leftLowerLeg.parent = leftLegBone;
    leftLowerLeg.position.y = -upperLegLength - lowerLegLength / 2;
    leftLowerLeg.material = matPants;
    bodyParts.leftLowerLeg = leftLowerLeg;

    const rightUpperLeg = BABYLON.MeshBuilder.CreateCylinder(config.name + '_rightUpperLeg', {
        height: upperLegLength,
        diameterTop: legWidth * 1.1,
        diameterBottom: legWidth
    }, scene);
    rightUpperLeg.parent = rightLegBone;
    rightUpperLeg.position.y = -upperLegLength / 2;
    rightUpperLeg.material = matPants;
    bodyParts.rightUpperLeg = rightUpperLeg;

    const rightLowerLeg = BABYLON.MeshBuilder.CreateCylinder(config.name + '_rightLowerLeg', {
        height: lowerLegLength,
        diameterTop: legWidth * 0.9,
        diameterBottom: legWidth * 0.7
    }, scene);
    rightLowerLeg.parent = rightLegBone;
    rightLowerLeg.position.y = -upperLegLength - lowerLegLength / 2;
    rightLowerLeg.material = matPants;
    bodyParts.rightLowerLeg = rightLowerLeg;

    const footHeight = 0.1 * config.scale;
    const footWidth = 0.12 * config.scale;
    const footDepth = 0.2 * config.scale;

    const leftFoot = BABYLON.MeshBuilder.CreateBox(config.name + '_leftFoot', {
        width: footWidth,
        height: footHeight,
        depth: footDepth
    }, scene);
    leftFoot.parent = leftLegBone;
    leftFoot.position = new BABYLON.Vector3(0, -upperLegLength - lowerLegLength - footHeight / 2, footDepth * 0.3);
    leftFoot.material = matSkin;
    bodyParts.leftFoot = leftFoot;

    const rightFoot = BABYLON.MeshBuilder.CreateBox(config.name + '_rightFoot', {
        width: footWidth,
        height: footHeight,
        depth: footDepth
    }, scene);
    rightFoot.parent = rightLegBone;
    rightFoot.position = new BABYLON.Vector3(0, -upperLegLength - lowerLegLength - footHeight / 2, footDepth * 0.3);
    rightFoot.material = matSkin;
    bodyParts.rightFoot = rightFoot;

    const walkCycle = createWalkAnimation(scene, config.name, {
        leftLegBone,
        rightLegBone,
        leftArmBone,
        rightArmBone,
        torsoBone,
        hipBone,
        speed: 1 + Math.random() * 0.5
    });

    return {
        root: character,
        bones,
        bodyParts,
        walkCycle,
        config,
        startWalking: () => {
            if (walkCycle) {
                scene.beginAnimation(walkCycle, 0, 1, true, 1);
            }
        },
        stopWalking: () => {
            if (walkCycle) {
                scene.stopAnimation(walkCycle);
            }
        }
    };
}

function createWalkAnimation(scene, name, bones) {
    const frameRate = 30;
    const cycleFrames = 60;
    const { leftLegBone, rightLegBone, leftArmBone, rightArmBone, torsoBone, hipBone, speed } = bones;

    const walkGroup = new BABYLON.AnimationGroup(name + '_walk', scene);

    const leftLegAnim = new BABYLON.Animation(
        name + '_leftLeg_anim',
        'rotation.x',
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );

    const leftLegKeys = [];
    for (let i = 0; i <= cycleFrames; i++) {
        const t = i / cycleFrames;
        const angle = Math.sin(t * Math.PI * 2) * 0.5 * speed;
        leftLegKeys.push({ frame: i, value: angle });
    }
    leftLegAnim.setKeys(leftLegKeys);
    leftLegBone.animations.push(leftLegAnim);
    walkGroup.addTargetedAnimation(leftLegAnim, leftLegBone);

    const rightLegAnim = new BABYLON.Animation(
        name + '_rightLeg_anim',
        'rotation.x',
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );

    const rightLegKeys = [];
    for (let i = 0; i <= cycleFrames; i++) {
        const t = i / cycleFrames;
        const angle = Math.sin(t * Math.PI * 2 + Math.PI) * 0.5 * speed;
        rightLegKeys.push({ frame: i, value: angle });
    }
    rightLegAnim.setKeys(rightLegKeys);
    rightLegBone.animations.push(rightLegAnim);
    walkGroup.addTargetedAnimation(rightLegAnim, rightLegBone);

    const leftArmAnim = new BABYLON.Animation(
        name + '_leftArm_anim',
        'rotation.x',
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );

    const leftArmKeys = [];
    for (let i = 0; i <= cycleFrames; i++) {
        const t = i / cycleFrames;
        const angle = Math.sin(t * Math.PI * 2 + Math.PI) * 0.4 * speed;
        leftArmKeys.push({ frame: i, value: angle });
    }
    leftArmAnim.setKeys(leftArmKeys);
    leftArmBone.animations.push(leftArmAnim);
    walkGroup.addTargetedAnimation(leftArmAnim, leftArmBone);

    const rightArmAnim = new BABYLON.Animation(
        name + '_rightArm_anim',
        'rotation.x',
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );

    const rightArmKeys = [];
    for (let i = 0; i <= cycleFrames; i++) {
        const t = i / cycleFrames;
        const angle = Math.sin(t * Math.PI * 2) * 0.4 * speed;
        rightArmKeys.push({ frame: i, value: angle });
    }
    rightArmAnim.setKeys(rightArmKeys);
    rightArmBone.animations.push(rightArmAnim);
    walkGroup.addTargetedAnimation(rightArmAnim, rightArmBone);

    const torsoAnim = new BABYLON.Animation(
        name + '_torso_anim',
        'rotation.z',
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );

    const torsoKeys = [];
    for (let i = 0; i <= cycleFrames; i++) {
        const t = i / cycleFrames;
        const angle = Math.sin(t * Math.PI * 2) * 0.05 * speed;
        torsoKeys.push({ frame: i, value: angle });
    }
    torsoAnim.setKeys(torsoKeys);
    torsoBone.animations.push(torsoAnim);
    walkGroup.addTargetedAnimation(torsoAnim, torsoBone);

    const hipAnim = new BABYLON.Animation(
        name + '_hip_anim',
        'position.y',
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );

    const hipKeys = [];
    for (let i = 0; i <= cycleFrames; i++) {
        const t = i / cycleFrames;
        const y = 1.0 + Math.abs(Math.sin(t * Math.PI * 2)) * 0.05 * speed;
        hipKeys.push({ frame: i, value: y });
    }
    hipAnim.setKeys(hipKeys);
    hipBone.animations.push(hipAnim);
    walkGroup.addTargetedAnimation(hipAnim, hipBone);

    return walkGroup;
}

function spawnWalkingCharacters(scene, count, bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }) {
    const characters = [];
    const charactersData = [];

    for (let i = 0; i < count; i++) {
        const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        const z = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);

        const character = createProceduralCharacter(scene, {
            position: new BABYLON.Vector3(x, 0, z),
            scale: 0.8 + Math.random() * 0.4
        });

        character.root.rotation.y = Math.random() * Math.PI * 2;

        const speed = 0.5 + Math.random() * 1.5;
        const direction = Math.random() * Math.PI * 2;
        const wanderRadius = 5 + Math.random() * 10;
        const centerX = x;
        const centerZ = z;

        characters.push(character);
        charactersData.push({
            character,
            speed,
            direction,
            wanderRadius,
            centerX,
            centerZ,
            turnTimer: 0,
            changeDirTime: 2 + Math.random() * 4
        });

        character.startWalking();
    }

    scene.onBeforeRenderObservable.add(() => {
        const deltaTime = scene.getEngine().getDeltaTime() / 1000;

        charactersData.forEach((data, index) => {
            data.turnTimer += deltaTime;

            if (data.turnTimer >= data.changeDirTime) {
                data.direction += (Math.random() - 0.5) * Math.PI;
                data.turnTimer = 0;
                data.changeDirTime = 2 + Math.random() * 4;
            }

            const newX = data.character.root.position.x + Math.sin(data.direction) * data.speed * deltaTime;
            const newZ = data.character.root.position.z + Math.cos(data.direction) * data.speed * deltaTime;

            if (newX < bounds.minX || newX > bounds.maxX || newZ < bounds.minZ || newZ > bounds.maxZ) {
                data.direction = Math.atan2(-Math.sin(data.direction), -Math.cos(data.direction));
            }

            data.character.root.position.x = newX;
            data.character.root.position.z = newZ;

            const targetRotation = data.direction;
            const currentRotation = data.character.root.rotation.y;
            let diff = targetRotation - currentRotation;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            data.character.root.rotation.y += diff * 5 * deltaTime;
        });
    });

    return characters;
}

function randomColor(colors) {
    return colors[Math.floor(Math.random() * colors.length)];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createProceduralCharacter, spawnWalkingCharacters };
}