// 资源目录的唯一维护来源。调整分类、文案或链接时只需编辑此文件。
window.RESOURCE_GROUPS = [
  {
    title: '实用工具',
    items: [
      {
        title: '火の眼',
        icon: 'eye',
        description: '查看火羽直播间的弹幕、醒目留言、话题与历史趋势。',
        tags: ['直播数据', '弹幕', 'SC'],
        aliases: ['火之眼', '火眼', 'hinome'],
        url: 'https://best-hinome.pages.dev/',
      },
      {
        title: '万舰的风景',
        icon: 'voyage',
        description: '火羽万舰纪念站，可查找舰长并制作纪念卡。',
        tags: ['万舰', '舰长', '纪念卡'],
        aliases: ['万舰纪念站', '舰长'],
        url: 'https://hinome-captains.pages.dev/',
      },
      {
        title: '火羽舰队',
        icon: 'fleet',
        description: '沿时间轴浏览火羽大航海历史，可按昵称、UID 或编号寻舟。',
        tags: ['大航海', '时间轴', '寻舟'],
        aliases: ['HANE VOYAGE', '舰队'],
        url: 'https://hane-lab.github.io/HANE-VOYAGE/',
      },
      {
        title: '千舰史料 · 直播回放检索',
        icon: 'replay',
        description: '检索火羽 2022 年 10 月 10 日至 13 日四场直播的双语字幕、弹幕、SC 和上舰记录。',
        tags: ['千舰', '历史回放', '双语字幕'],
        aliases: ['千舰回放', '千舰纪念', 'renode-editor'],
        url: 'https://hinome.renode-editor.com/',
      },
      {
        title: '火羽ひのめ · 直播回放字幕检索',
        icon: 'replay',
        description: '按直播场次浏览字幕，搜索日文原文或中文翻译。',
        tags: ['字幕检索', '双语字幕', '直播回放'],
        aliases: ['hinome-subtitles', '中日字幕'],
        url: 'https://hinome-subtitles.pages.dev/',
      },
    ],
  },
  {
    title: '百科资料',
    items: [
      {
        title: '火羽ひのめ百科',
        icon: 'encyclopedia',
        description:
          '猫猫のOvO 汇编的火羽相关链接与资料，涵盖时间线、回放、作品及工具。',
        tags: ['资料索引', '直播回放'],
        aliases: ['百科', '整合全网主要信息'],
        url: 'https://www.bilibili.com/opus/1264904066661613573',
      },
      {
        title: '火羽ひのめ 情报屋',
        icon: 'profile',
        description: '火羽ひのめ的人物介绍和设定图。',
        tags: ['人物设定', '设定图'],
        aliases: ['情报屋', 'HY Page'],
        url: 'https://ikaros-521.github.io/HY-Page/',
      },
    ],
  },
  {
    title: '影像档案',
    items: [
      {
        title: '绝对不会抛下B站去其他地方的日本vtuber',
        icon: 'original',
        description: '火羽ひのめ的 B 站投稿。',
        tags: ['本人投稿', '视频'],
        aliases: ['日本vtuber', '原投稿'],
        url: 'https://www.bilibili.com/video/BV1NR4y1o7bK',
      },
      {
        title: '2022年10月12日火羽生日会直播录像',
        icon: 'replay',
        description: '2022 年火羽生日会的直播录像。',
        tags: ['生日会', '完整回放', '历史回放', '2022'],
        aliases: ['生日', '直播回放'],
        url: 'https://www.bilibili.com/video/BV1iMnY6BEJb',
      },
    ],
  },
  {
    title: '亲历回顾',
    items: [
      {
        title: '【火羽ひのめ】我对火羽的所见所闻',
        icon: 'letter',
        description: '巨妖影崩从个人视角讲述与火羽有关的见闻。',
        tags: ['个人见闻'],
        aliases: ['巨妖影崩'],
        url: 'https://www.bilibili.com/video/BV15e411V7kT/',
      },
      {
        title: '【魈格Yezpi】火羽老粉的匆匆那年那些事',
        icon: 'letter',
        description: '魈格Yezpi回顾作为火羽老观众的经历，由青山雨雀投稿。',
        tags: ['老粉回忆'],
        aliases: ['魈格', '青山雨雀'],
        url: 'https://www.bilibili.com/video/BV1wdpZ6hEQW/',
      },
      {
        title: '老资历深情回忆：那些年与火羽大小姐和各位老资历的峥嵘岁月',
        icon: 'letter',
        description: 'ブリュンヒルト回忆火羽和早期观众，由冬来盼春至投稿。',
        tags: ['老粉回忆'],
        aliases: ['冬来盼春至', '布伦希尔德'],
        url: 'https://www.bilibili.com/video/BV1W2Jv64EuG/',
      },
      {
        title: '关于前皮套运营的我被火羽小姐干出走马灯的这件事',
        icon: 'letter',
        description: '残障少女德莉珐以曾做过皮套运营的视角谈火羽。',
        tags: ['运营视角', '个人回顾'],
        aliases: ['德莉珐', '走马灯'],
        url: 'https://www.bilibili.com/video/BV1y5WF6KEuc/',
      },
    ],
  },
  {
    title: '二创作品',
    items: [
      {
        title: '《信》',
        icon: 'letter',
        description: '丰川大肥鱼按时间串起火羽 2081 天的 B 站动态。',
        tags: ['动态回顾', '时间轴'],
        aliases: ['信', '丰川大肥鱼'],
        url: 'https://www.bilibili.com/video/BV1fEpy67E9v',
      },
      {
        title: '《誓火未熄》',
        icon: 'anthem',
        description: '火羽ひのめ应援曲。',
        tags: ['应援曲', '音乐'],
        aliases: ['誓火未熄'],
        url: 'https://www.bilibili.com/video/BV133nM68Eea',
      },
    ],
  },
];
