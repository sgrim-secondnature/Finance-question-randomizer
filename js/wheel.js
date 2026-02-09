let names = [];
const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const r = canvas.width / 2;
let slice;

let rotation = 0;
let spinning = false;

function drawWheel(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  names.forEach((name,i)=>{
    const angle = rotation + i * slice;

    ctx.beginPath();
    ctx.moveTo(r,r);
    ctx.arc(r,r,r-10,angle,angle+slice);
    ctx.fillStyle = i % 2 === 0 ? "#9d4edd" : "#c77dff";
    ctx.fill();

    ctx.save();
    ctx.translate(r,r);
    ctx.rotate(angle + slice/2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.font = "600 16px Arial";
    ctx.fillText(name, r-20, 6);
    ctx.restore();
  });

  // pointer at TOP (12 o'clock)
  ctx.beginPath();
  ctx.moveTo(r-12, 5);
  ctx.lineTo(r+12, 5);
  ctx.lineTo(r, 30);
  ctx.closePath();
  ctx.fillStyle = "#000";
  ctx.fill();
}

function spin(){
  if(spinning) return;
  spinning = true;

  const spins = Math.random()*5 + 6;
  const target = rotation + spins * Math.PI * 2;
  const start = performance.now();
  const duration = 3000;

  function animate(time){
    const t = Math.min((time-start)/duration,1);
    rotation = target * (1 - Math.pow(1-t,3));
    drawWheel();

    if(t < 1){
      requestAnimationFrame(animate);
    } else {
      //  Correct winner under the TOP pointer (12 o'clock)
      const twoPi = Math.PI * 2;
      const normalized = ((rotation % twoPi) + twoPi) % twoPi; // 0..2π
      const pointerAngle = (3 * Math.PI) / 2;                 // 12 o'clock
      const relative = (pointerAngle - normalized + twoPi) % twoPi;
      const index = Math.floor(relative / slice) % names.length;

      document.getElementById("winner").textContent = "Winner: " + names[index];
      spinning = false;
    }
  }
  requestAnimationFrame(animate);
}

// Load team data and initialize the wheel
fetch("data/team.json")
  .then(res => res.json())
  .then(data => {
    names = data.members;
    slice = (Math.PI * 2) / names.length;
    drawWheel();
  })
  .catch(err => console.error("Failed to load team data:", err));
