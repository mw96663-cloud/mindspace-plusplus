
/**
 * Plus-Plus Layered AI Director
 * ai-director.js
 */

window.PPDirector=(()=>{
  "use strict";

  function targetHero(decision) {
    return findHero(
      String(decision.target||"")
    );
  }

  function movement(value) {
    const allowed=[
      "float","walk","fly",
      "swim","bounce","glide"
    ];

    return allowed.includes(value)?
      value:"float";
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

    burst(
      hero.x*width,
      hero.y*height,
      30
    );

    return true;
  }

  async function addAccessory(decision) {
    const hero=targetHero(decision);

    if(!hero) {
      throw new Error(
        "目前沒有角色，請先拍攝積木作品。"
      );
    }

    const description=String(
      decision.description||
      decision.name||
      "a colorful fantasy accessory"
    );

    busy(
      true,
      "🧩 正在為「"+hero.name+
      "」增加 Plus-Plus 造型……"
    );

    const result=await ai(
      "generateAccessory",
      {
        description,
        originalDescription:hero.description
      },
      180000
    );

    const image=await loadPicture(result.image);
    const preset=accessoryPlacement(
      decision.placement
    );

    const name=String(
      decision.name||"新造型"
    );

    const isWing=/wing|翅膀|羽翼/i.test(
      name+" "+description
    );

    const part={
      id:uid(),
      name,
      description,
      image,
      imageData:result.image,

      // 獨立圖層，不修改原始積木
      layer:preset.layer,
      position:{
        x:preset.position.x,
        y:preset.position.y
      },
      scale:preset.scale,
      animate:isWing?"flap":"none"
    };

    hero.accessories.push(part);

    updateHeroList();

    burst(
      hero.x*width,
      hero.y*height,
      65,
      "#d8c4ff"
    );

    confirmSound();

    if(
      decision.movement==="fly"||
      (
        isWing&&
        /fly|flying|飛/i.test(
          String(decision.description||"")+
          String(decision.reply||"")
        )
      )
    ) {
      setMovement(hero,"fly");
    }

    return hero;
  }

  function removeAccessory(decision) {
    const hero=targetHero(decision);
    if(!hero)return false;

    const name=String(
      decision.name||""
    ).trim();

    if(!name) {
      const removed=hero.accessories.pop();
      updateHeroList();
      return !!removed;
    }

    const index=hero.accessories.findIndex(
      part=>
        part.name.includes(name)||
        name.includes(part.name)
    );

    if(index<0)return false;

    hero.accessories.splice(index,1);
    updateHeroList();

    burst(
      hero.x*width,
      hero.y*height,
      25
    );

    return true;
  }

  async function addEnvironmentObject(decision) {
    const description=String(
      decision.description||
      decision.name||
      "a colorful tree"
    );

    busy(
      true,
      "🌳 正在增加 Plus-Plus 積木物件……"
    );

    const result=await ai(
      "generateEnvironmentObject",
      {description},
      180000
    );

    const image=await loadPicture(result.image);
    const count=S.environmentObjects.length;

    const locations=[
      {x:.22,y:.69},
      {x:.78,y:.67},
      {x:.35,y:.78},
      {x:.66,y:.78},
      {x:.5,y:.47}
    ];

    const pos=
      locations[count%locations.length];

    const object={
      id:uid(),
      name:String(
        decision.name||"新物件"
      ),
      description,
      image,
      imageData:result.image,
      x:pos.x,
      y:pos.y,
      size:.28,
      phase:Math.random()*Math.PI*2
    };

    S.environmentObjects.push(object);

    burst(
      object.x*width,
      object.y*height,
      55,
      "#b8e7cb"
    );

    confirmSound();
    return object;
  }

  async function regenerateWorld(decision) {
    const prompt=String(
      decision.worldPrompt||
      decision.description||
      ""
    ).trim();

    if(!prompt) {
      throw new Error(
        "AI 沒有提供新背景描述"
      );
    }

    busy(
      true,
      "🌈 正在改變 Plus-Plus 世界……"
    );

    const info={
      name:decision.name||S.worldName,
      worldName:
        decision.name||S.worldName,
      worldPrompt:prompt,
      description:prompt
    };

    const hasScene=
      !!S.originalScene&&!!S.lastPhoto;

    const result=await ai(
      hasScene?
        "generateEnvironmentLayer":
        "generateWorld",
      hasScene?
        {image:S.lastPhoto,info}:
        {info},
      180000
    );

    await setWorld(
      result.image,
      info.worldName
    );

    S.worldPrompt=prompt;

    effect(
      decision.effect||"sparkle"
    );
  }

  async function addCharacter(decision) {
    busy(
      true,
      "🧩 正在創造新的 Plus-Plus 朋友……"
    );

    const description=String(
      decision.description||
      decision.name||
      "a friendly creature"
    );

    const result=await ai(
      "generateCharacter",
      {description},
      180000
    );

    const image=await loadPicture(
      result.image
    );

    const hero=newHero(
      image,
      result.image,
      {
        name:decision.name||"新朋友",
        description,
        movement:movement(
          decision.movement
        )
      }
    );

    if(decision.movement) {
      setMovement(
        hero,
        decision.movement
      );
    }

    return hero;
  }

  async function execute(decision) {
    if(
      !decision||
      typeof decision!=="object"
    ) {
      throw new Error(
        "AI 沒有回傳有效操作指令"
      );
    }

    const action=String(
      decision.action||"none"
    );

    let hero=targetHero(decision);

    switch(action) {
      case "addAccessory":
        hero=await addAccessory(decision);
        break;

      case "removeAccessory":
        if(!removeAccessory(decision)) {
          throw new Error(
            "找不到要移除的造型"
          );
        }
        break;

      case "addEnvironmentObject":
        await addEnvironmentObject(decision);
        hero=null;
        break;

      case "regenerateWorld":
        await regenerateWorld(decision);
        hero=null;
        break;

      case "addCharacter":
        hero=await addCharacter(decision);
        break;

      case "changeMovement":
        if(!setMovement(
          hero,
          decision.movement
        )) {
          throw new Error(
            "目前沒有可以操作的角色"
          );
        }
        break;

      case "move":
        if(!hero) {
          throw new Error(
            "目前沒有角色"
          );
        }

        hero.direction*=-1;
        burst(
          hero.x*width,
          hero.y*height,
          25
        );
        break;

      case "changeSize":
        if(!hero) {
          throw new Error(
            "目前沒有角色"
          );
        }

        hero.scale=clamp(
          Number(decision.size)||1,
          .5,2
        );

        burst(
          hero.x*width,
          hero.y*height,
          30
        );
        break;

      case "effect":
        effect(
          decision.effect||"sparkle"
        );
        break;

      case "none":
      default:
        break;
    }

    speak(
      decision.reply||
      "你的想像已加入世界！接下來還想創造什麼呢？",
      hero
    );
  }

  return {
    execute,
    addAccessory,
    removeAccessory,
    addEnvironmentObject,
    regenerateWorld,
    addCharacter,
    setMovement
  };
})();
