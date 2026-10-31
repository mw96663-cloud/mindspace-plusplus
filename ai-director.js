
/**
 * Plus-Plus Layered AI Director
 * Compatible with Mindspace V2 Bridge
 */

window.PPDirector=(()=>{
  "use strict";

  function targetHero(d) {
    return findHero(String(d.target||""));
  }

  function movement(value) {
    const allowed=[
      "float","walk","fly",
      "swim","bounce","glide"
    ];
    return allowed.includes(value)?value:"float";
  }

  function setMovement(hero,value) {
    if(!hero)return false;

    hero.movement=movement(value);

    const positions={
      fly:.42,
      swim:.62,
      walk:.76,
      bounce:.70,
      float:.65,
      glide:.48
    };

    hero.baseY=positions[hero.movement];
    hero.y=hero.baseY;
    burst(hero.x*width,hero.y*height,30);
    return true;
  }

  async function addAccessory(d) {
    const hero=targetHero(d);

    if(!hero) {
      throw new Error("請先拍攝一個積木角色");
    }

    const description=String(
      d.description||d.name||
      "a colorful fantasy accessory"
    );

    busy(true,"🧩 正在為「"+hero.name+"」新增造型……");

    const result=await ai(
      "generateAccessory",
      {
        description,
        originalDescription:hero.description
      },
      180000
    );

    const img=await loadPicture(result.image);
    const preset=accessoryPlacement(d.placement);
    const name=String(d.name||"新造型");

    const isWing=/wing|翅膀|羽翼/i.test(
      name+" "+description
    );

    hero.accessories.push({
      id:uid(),
      name,
      description,
      image:img,
      imageData:result.image,
      layer:preset.layer,
      position:{
        x:preset.position.x,
        y:preset.position.y
      },
      scale:preset.scale,
      animate:isWing?"flap":"none"
    });

    updateHeroList();
    burst(
      hero.x*width,
      hero.y*height,
      65,"#d8c4ff"
    );
    confirmSound();

    if(
      d.movement==="fly"||
      (isWing&&/fly|flying|飛/i.test(
        String(d.description||"")+
        String(d.reply||"")
      ))
    ) {
      setMovement(hero,"fly");
    }

    return hero;
  }

  function removeAccessory(d) {
    const hero=targetHero(d);
    if(!hero)return false;

    const name=String(d.name||"").trim();

    if(!name) {
      const removed=hero.accessories.pop();
      updateHeroList();
      return !!removed;
    }

    const index=hero.accessories.findIndex(
      a=>a.name.includes(name)||
        name.includes(a.name)
    );

    if(index<0)return false;

    hero.accessories.splice(index,1);
    updateHeroList();
    burst(hero.x*width,hero.y*height,25);
    return true;
  }

  async function addEnvironmentObject(d) {
    const description=String(
      d.description||d.name||"a colorful tree"
    );

    busy(true,"🌳 正在生成 Plus-Plus 世界物件……");

    const result=await ai(
      "generateEnvironmentObject",
      {description},180000
    );

    const img=await loadPicture(result.image);
    const count=S.environmentObjects.length;

    const places=[
      {x:.22,y:.69},
      {x:.78,y:.67},
      {x:.35,y:.78},
      {x:.66,y:.78},
      {x:.5,y:.47}
    ];

    const pos=places[count%places.length];

    const obj={
      id:uid(),
      name:String(d.name||"新物件"),
      description,
      image:img,
      imageData:result.image,
      x:pos.x,
      y:pos.y,
      size:.28,
      phase:Math.random()*Math.PI*2
    };

    S.environmentObjects.push(obj);
    burst(
      obj.x*width,obj.y*height,
      55,"#b8e7cb"
    );
    confirmSound();
    return obj;
  }

  async function regenerateWorld(d) {
    const prompt=String(
      d.worldPrompt||d.description||""
    ).trim();

    if(!prompt) {
      throw new Error("AI 沒有提供新背景描述");
    }

    busy(true,"🌈 正在改變 Plus-Plus 世界……");

    const info={
      name:d.name||S.worldName,
      worldName:d.name||S.worldName,
      worldPrompt:prompt,
      description:prompt
    };

    const scene=!!S.originalScene;

    const result=await ai(
      scene?"generateEnvironmentLayer":"generateWorld",
      {
        image:S.lastPhoto,
        info
      },
      180000
    );

    await setWorld(result.image,info.worldName);
    S.worldPrompt=prompt;
    effect(d.effect||"sparkle");
    return null;
  }

  async function addCharacter(d) {
    busy(true,"🧩 正在創造新的 Plus-Plus 朋友……");

    const result=await ai(
      "generateCharacter",
      {
        description:d.description||
          d.name||"a friendly creature"
      },
      180000
    );

    const img=await loadPicture(result.image);

    const hero={
      id:uid(),
      name:String(d.name||"新朋友"),
      description:String(d.description||""),
      original:img,
      originalData:result.image,
      accessories:[],
      x:.3+Math.random()*.4,
      y:.67,
      baseY:.67,
      size:270,
      scale:1,
      direction:1,
      speed:.00007,
      movement:movement(d.movement),
      phase:Math.random()*Math.PI*2,
      entering:false,
      speech:"",
      speechUntil:0
    };

    S.heroes.push(hero);
    S.selectedId=hero.id;

    if(d.movement) {
      setMovement(hero,d.movement);
    }

    updateHeroList();
    burst(hero.x*width,hero.y*height,55);
    return hero;
  }

  async function execute(d) {
    if(!d||typeof d!=="object") {
      throw new Error("AI 沒有回傳有效指令");
    }

    const action=String(d.action||"none");
    let hero=targetHero(d);

    switch(action) {
      case "addAccessory":
        hero=await addAccessory(d);
        break;

      case "removeAccessory":
        if(!removeAccessory(d)) {
          throw new Error("找不到要移除的造型");
        }
        break;

      case "addEnvironmentObject":
        await addEnvironmentObject(d);
        hero=null;
        break;

      case "regenerateWorld":
        await regenerateWorld(d);
        hero=null;
        break;

      case "addCharacter":
        hero=await addCharacter(d);
        break;

      case "changeMovement":
        if(!setMovement(hero,d.movement)) {
          throw new Error("目前沒有可操作的角色");
        }
        break;

      case "move":
        if(!hero)throw new Error("目前沒有角色");
        hero.direction*=-1;
        burst(hero.x*width,hero.y*height,25);
        break;

      case "changeSize":
        if(!hero)throw new Error("目前沒有角色");
        hero.scale=clamp(Number(d.size)||1,.5,2);
        burst(hero.x*width,hero.y*height,30);
        break;

      case "effect":
        effect(d.effect||"sparkle");
        break;

      case "none":
      default:
        break;
    }

    speak(
      d.reply||
      "你的想像已加入世界！接下來還想創造什麼呢？",
      hero
    );
  }

  return {
    execute,
    addAccessory,
    removeAccessory,
    addEnvironmentObject,
    regenerateWorld
  };
})();
