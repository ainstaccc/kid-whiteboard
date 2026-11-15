// 示範課程：沒有 API 金鑰時使用，不花錢、不連網
const lesson = {
  title: '三角形的三個邊（示範課）',
  steps: [
    {
      say: '哈囉！今天我們來認識三角形，它有三條邊和三個角喔。',
      clear: true,
      draw: [
        { type: 'polygon', points: [[200, 450], [700, 450], [450, 130]], color: 'blue' },
        { type: 'text', x: 450, y: 70, text: '三角形', size: 44, color: 'purple' },
      ],
    },
    {
      say: '先數數看，這三條邊分別是左邊、右邊和下面。',
      draw: [
        { type: 'text', x: 290, y: 270, text: '左邊', size: 32, color: 'red' },
        { type: 'text', x: 620, y: 270, text: '右邊', size: 32, color: 'green' },
        { type: 'text', x: 450, y: 510, text: '下面', size: 32, color: 'orange' },
      ],
    },
    {
      say: '再看看三個尖尖的地方，我們叫它「角」。你覺得有幾個角呢？',
      pause_for_student: true,
      draw: [
        { type: 'circle', x: 200, y: 450, r: 22, color: 'red', dashed: true },
        { type: 'circle', x: 700, y: 450, r: 22, color: 'red', dashed: true },
        { type: 'circle', x: 450, y: 130, r: 22, color: 'red', dashed: true },
      ],
    },
    {
      say: '沒錯，三個角！記住：三角形有三條邊、三個角，剛剛好。',
      clear: true,
      draw: [
        { type: 'text', x: 500, y: 200, text: '3 條邊', size: 56, color: 'blue' },
        { type: 'text', x: 500, y: 320, text: '3 個角', size: 56, color: 'red' },
        { type: 'arrow', x: 500, y: 360, x2: 500, y2: 450, color: 'green' },
        { type: 'text', x: 500, y: 520, text: '三角形', size: 48, color: 'purple' },
      ],
    },
  ],
};

const ask = {
  title: '回答',
  steps: [
    {
      say: '好問題！（示範模式的固定回答）真正連上 AI 之後，小白板老師會針對你的問題重新畫圖講解。',
      draw: [{ type: 'text', x: 500, y: 300, text: '好問題！', size: 56, color: 'orange' }],
    },
  ],
};

const wrapup = {
  notes: ['三角形有 3 條邊', '三角形有 3 個角', '邊和角的數量一樣多'],
  quiz: [
    {
      q: '三角形有幾個角？',
      options: ['2 個', '3 個', '4 個'],
      answer: 1,
      explain: '三角形有 3 個角，名字裡的「三」就是提示喔！',
    },
    {
      q: '三角形有幾條邊？',
      options: ['3 條', '4 條', '5 條'],
      answer: 0,
      explain: '三條邊圍起來，就是三角形。',
    },
  ],
};

module.exports = { lesson, ask, wrapup };
