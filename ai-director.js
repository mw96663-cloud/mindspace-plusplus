
"use strict";

/*
  PLUS-PLUS WORLD — AI DIRECTOR V1

  AI 決定創意內容。
  這個檔案只負責將結構化操作執行出來。
*/

const Director = {
  handlers:{},
  working:false
};

function directorHero(name) {
  const text=String(name||"").trim();

  return S.heroes.find(h=>h.name===text) ||
    S.heroes.find(h=>h.id===text) ||
    S.heroes.find(h=>h.id===S.selectedId) ||
    S.heroes[0] ||
    null;
}

function directorEffect(type,color="#fff1b0",count=40) {
  startSceneEffect({type,color,count});
}

async function directorTransform(hero,description) {
  if (!hero || !description) return;

  status("🪄 正在改造 "+hero.name);

  const result=await callAI("transform",{
    image:hero.imageData,
    description
  },180000);

  hero.image=await imageLoad(result.image);
  hero.imageData=result.image;

  directorEffect("sparkle","#fff1b0",35);
}

async function directorNewHero(item) {
  const name=String(item.name||"新朋友").slice(0,40);
  const description=String(item.description||name).slice(0,1000);

  status("🧩 正在創造 "+name);

  const result=await callAI("generateCharacter",{
    description
  },180000);

  const hero={
    id:uid(),
    name,
    description,
    image:await imageLoad(result.image),
    imageData:result.image,
    originalImage:result.image,
    movement:item.movement||"float",
    skills:[],
    x:.25+Math.random()*.5,
    y:.55,
    size:135,
    phase:Math.random()*6.28,
    direction:1,
    speed:.00007,
    created:performance.now(),
    action:null
  };

  S.heroes.push(hero);
  S.selectedId=hero.id;
  updateHeroList();
  directorEffect("sparkle","#f9e5a6",45);

  return hero;
}

async function directorWorld(description) {
  if (!description) return;

  status("🌈 正在生成新的積木世界");

  const result=await callAI("generateWorld",{
    description
  },180000);

  await setWorldImage(result.image,"我的想像世界");
  directorEffect("sparkle","#fff3b5",55);
}

Director.handlers.move=async function(action) {
  const hero=directorHero(action.target);
  if (!hero) return;

  hero.action={
    start:performance.now(),
    duration:1800,
    x:clamp(Number(action.x)||.5,.08,.92),
    y:clamp(Number(action.y)||.5,.15,.85)
  };
};

Director.handlers.movement=async function(action) {
  const hero=directorHero(action.target);
  if (!hero) return;

  const allowed=new Set([
    "walk","fly","swim","float","crawl","hop"
  ]);

  if (allowed.has(action.movement)) {
    hero.movement=action.movement;
    directorEffect("sparkle","#fff2ad",25);
  }
};

Director.handlers.skill=async function(action) {
  const hero=directorHero(action.target);
  if (!hero) return;

  const description=String(action.description||"").trim();
  if (!description) return;

  hero.skills.push({
    name:description,
    created:Date.now()
  });

  /*
    技能可能包含外觀改造。
    讓圖片 AI 依照描述加上對應積木部件。
  */
  await directorTransform(hero,description);

  directorEffect(
    action.effect||"sparkle",
    "#ffe39b",45
  );
};

Director.handlers.transform=async function(action) {
  const hero=directorHero(action.target);
  if (!hero) return;
  await directorTransform(hero,action.description);
};

Director.handlers.changeWorld=async function(action,result) {
  const description=result.worldPrompt ||
    action.description;

  await directorWorld(description);
};

Director.handlers.addCharacter=async function(action,result) {
  /*
    AI 可能一次要求多個新角色。
    優先使用 newCharacters 的詳細造型描述。
  */
  const items=Array.isArray(result.newCharacters)
    ?result.newCharacters:[];

  if (items.length) {
    for(const item of items.slice(0,3)) {
      await directorNewHero(item);
    }
  } else if(action.description) {
    await directorNewHero({
      name:action.target||"新朋友",
      description:action.description,
      movement:action.movement||"float"
    });
  }
};

Director.handlers.effect=async function(action) {
  directorEffect(
    action.effect||"sparkle",
    "#fff1b0",50
  );
};

Director.handlers.speak=async function(action) {
  const hero=directorHero(action.target);
  const text=String(action.description||"").slice(0,200);
  if(text)announce(hero?.name||"AI 夥伴",text);
};

async function applyDirector(result) {
  if (!result || Director.working) return;

  Director.working=true;

  try {
    const actions=Array.isArray(result.actions)
      ?result.actions.slice(0,15):[];

    const done=new Set();

    for(const action of actions) {
      if (!action || typeof action!=="object")continue;

      const type=String(action.type||"");
      const handler=Director.handlers[type];

      if (typeof handler!=="function")continue;

      /*
        同一回合避免同一個背景或新增角色請求
        被重複執行。
      */
      if (
        (type==="changeWorld" || type==="addCharacter") &&
        done.has(type)
      ) continue;

      await handler(action,result);
      done.add(type);
    }

    /*
      即使 AI 忘記列出 addCharacter 操作，
      但已提供 newCharacters，也能建立角色。
    */
    if (
      !done.has("addCharacter") &&
      Array.isArray(result.newCharacters)
    ) {
      for(const item of result.newCharacters.slice(0,3)) {
        await directorNewHero(item);
      }
    }

    /*
      AI 提供背景描述時，也可以獨立更新場景。
    */
    if (
      !done.has("changeWorld") &&
      result.worldPrompt
    ) {
      await directorWorld(result.worldPrompt);
    }

  } finally {
    Director.working=false;
  }
}
