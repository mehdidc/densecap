var entityMap = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': '&quot;',
  "'": '&#39;',
  "/": '&#x2F;'
};
function escapeHtml(string) {
  return String(string).replace(/[&<>"'\/]/g, function (s) {
    return entityMap[s];
  });
}


$(function() {

  var SERVER_URL = null;
  var video_active = false;
  var demo_running = false;

  var NUM_TO_SHOW = 10;

  var IMAGE_DISPLAY_WIDTH = 800;
  var BOX_LINE_WIDTH = 6;
  var FONT_SIZE = 48;
  var TEXT_BOX_PAD = 5;
  var PAD = 10;

  // A nice set of colors
  var WAD_COLORS = [
    "rgb(173, 35, 35)",   // Red
    "rgb(42, 75, 215)",   // Blue
    "rgb(87, 87, 87)",    // Dark Gray
    "rgb(29, 105, 20)",   // Green
    "rgb(129, 74, 25)",   // Brown
    "rgb(129, 38, 192)",  // Purple
    "rgb(160, 160, 160)", // Lt Gray
    "rgb(129, 197, 122)", // Lt green
    "rgb(157, 175, 255)", // Lt blue
    "rgb(41, 208, 208)",  // Cyan
    "rgb(255, 146, 51)",  // Orange
    "rgb(255, 238, 51)",  // Yellow
    "rgb(233, 222, 187)", // Tan
    "rgb(255, 205, 243)", // Pink
    // "rgb(255, 255, 255)", // White
    "rgb(0, 0, 0)",       // Black
  ];

function capitalize(s)
{
    return s[0].toUpperCase() + s.slice(1);
}

  // Overall, the client-side program flow works like this:
  // First, we request a meadia stream object to access the webcam; once we have
  // it we bind it to a hidden <video> element and play the video. Now we can
  // talk to the server. To grab a frame, we write the video to a hidden canvas
  // and get json-encoded pixel data from the canvas as a DataURL. We pass this
  // to the server, which responds with annotations; we draw the image and
  // annotations to a second (visible) canvas, and repeat. Note that the client
  // does not include any sleeping; it should show frames as fast as the server
  // can process them. Also, to make the whole thing dummy-proof, we read the
  // server URL from a URL parameter. This should theoretically run on Android
  // but I haven't tested it; unfortunately it won't work on iOS.

  function get_url_param(name) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(location.search);
    if (results === null) return '';
    return decodeURIComponent(results[1].replace(/\+/g, " "));
  }
 
  // Draw image and annotations to the main canvas.
  function draw_image(image_url, data) {
    var pos = {
      x: 0,
      y: 0,
      w: IMAGE_DISPLAY_WIDTH,
      h: IMAGE_DISPLAY_WIDTH / data.width * data.height,
    };
    var canvas = document.getElementById('canvas');
    var ctx = canvas.getContext('2d');
    // We need to make a deep copy of pos since we don't use it right away
    pos = JSON.parse(JSON.stringify(pos));
    var img = new Image();
    img.onload = function() {
      var ori_height = img.height;
      var ori_width = img.width;

      // First draw a white retangle over everything
      ctx.save();
      ctx.fillStyle = 'rgb(255, 255, 255)';
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.fill();
      ctx.restore();

      ctx.drawImage(img, pos.x, pos.y, pos.w, pos.h);
      for (var i = 0; i < NUM_TO_SHOW && i < data.boxes.length; i++) {
        var box = data.boxes[i];
        var x = box[0], y = box[1],
            w = box[2], h = box[3];

        // We need to convert the box from the image-space coordinate system
        // to the coordinate system of the canvas where we are drawing it.
        // Also the input boxes are 1-indexed, and we want 0-indexed here.
        x = x * (pos.w / img.width) + pos.x;
        y = y * (pos.h / img.height) + pos.y;
        w = w * (pos.w / img.width);
        h = h * (pos.h / img.height);

        // Draw the box
        ctx.save();
        ctx.lineWidth = BOX_LINE_WIDTH;
        // ctx.strokeStyle = colors.foreground[i];
        ctx.strokeStyle = WAD_COLORS[i % WAD_COLORS.length];
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.stroke();
        ctx.restore();
        
        // Now draw the text
        ctx.save();
        ctx.font = '18px sans-serif';
        ctx.fillStyle = 'white';
        ctx.textBaseline = 'top';

        var text_width = ctx.measureText(data.captions[i]).width;
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = WAD_COLORS[i % WAD_COLORS.length];
        ctx.fillRect(x, y, text_width, 20);
        ctx.restore();

        ctx.fillText(data.captions[i], x, y);
        ctx.restore();
      }
    }
    img.src = image_url;
  }
    // render just the annotations, leave the image untouched and loaded
    function renderAnnotations(result) {
      var delt = $('#annotations'); // render into g element of svg
      delt.html(''); // flush contents of annotations <g> element
      var nshow = NUM_TO_SHOW;
      for (var k = 0; k < nshow; k++) {
        var det_box = result.boxes[k];
        var caption = result.captions[k];
        var color = WAD_COLORS[k % WAD_COLORS.length];
        delt.append('<span class="desc" style="color:'+color+'">' + capitalize(escapeHtml(caption)) + '.' + '</span>');
      }
    }

    // bind keys to controls
    document.onkeydown = function(e) {
      // d=68, a=65, w=87, s=83, t=84
      if (e.keyCode == 68) updateImg(1);
      if (e.keyCode == 65) updateImg(-1);
      if (e.keyCode == 83) updateCounter('detections_to_show', -1);
      if (e.keyCode == 87) updateCounter('detections_to_show', 1);
      if (e.keyCode == 84) toggleFlag('captions_inline');
      if (e.keyCode == 82) jumpRandom();
    };

    // "int main" function here
    function intmain() {
      loadData();
    }

    function jumpRandom() {
      current_id = Math.floor(Math.random()*(input_struct.results.length-1));
      renderImage();
    }

  // Grab an image from the webcam, send it to the server, and draw the results.
  var SIZE_W = 800;
  var SIZE_H = 800;
  function capture_image(){
        // Make sure that the video is active.
        if (!video_active) return;
        // By this point the webcam is streaming to the video object.
        // To get a frame, we draw the video to a canvas and then pull a data URL
        // from the canvas that has encoded pixel data.
        var video = document.getElementById('video');
        var img_canvas = document.getElementById('img-canvas');

        img_canvas.width = video.videoWidth;
        img_canvas.height = video.videoHeight;
	//img_canvas.width = SIZE_W;
        //img_canvas.height = SIZE_H;

        var ctx = img_canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        //ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, SIZE_W, SIZE_H);
        //update_annotations();
        if(last_annotations != null){
            img_url = img_canvas.toDataURL();
            draw_image(img_url, last_annotations);
            renderAnnotations(last_annotations);
        }
  }
  var last_annotations = null;
  function update_annotations() {
    // Make sure that the video is active.
    if (!video_active) return;
    // By this point the webcam is streaming to the video object.
    // To get a frame, we draw the video to a canvas and then pull a data URL
    // from the canvas that has encoded pixel data.
    var video = document.getElementById('video');
    var img_canvas = document.getElementById('img-canvas');
    
    img_canvas.width = video.videoWidth;
    img_canvas.height = video.videoHeight;
    //img_canvas.width = SIZE_W;
    //img_canvas.height = SIZE_H;



    var ctx = img_canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    //ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, SIZE_W, SIZE_H);
 
    // TODO: jpeg might not be supported on all browsers;
    // detect this somehow and fall back to png
    var img_url = img_canvas.toDataURL('image/jpeg');

    // Send the frame to the server
    var request = new XMLHttpRequest();
    request.open('POST', SERVER_URL, true);
    request.setRequestHeader('Content-Type', 'application/upload');
    request.onload = function(e) {
      // Once we have the response, render it and loop.
      var annotations = JSON.parse(request.responseText);
      last_annotations = annotations;
      //draw_image(img_url, annotations);
      if (demo_running) {
        //captureImage();
      }
    }
    request.send('img=' + img_url);
  }
  
  function success(stream) {
    var video = document.getElementById('video');

    video.addEventListener('canplay', function() {
      // Once the video is ready, set a flag and enable all buttons.
      video_active = true;
      var btn_ids = [
        '#btn-less', '#btn-more',
        '#btn-start', '#btn-stop',
        '#btn-smaller', '#btn-bigger',
      ];
      for (var i = 0; i < btn_ids.length; i++) {
        $(btn_ids[i]).attr('disabled', false);
      }
    });

    // Bind the webcam stream to the video object in the DOM.
    var vendorURL = window.URL || window.webkitURL;
    video.src = vendorURL.createObjectURL(stream);
    video.play();
  }
  
  function errorCallback(error) {
    console.log('ERROR: ', error);
  }

  // TODO: If these don't exist then show some sort of error message?
  navigator.getUserMedia = navigator.getUserMedia ||
    navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  
  var constraints = {
    audio: false,
    video: {width: 400, height: 400},
  };
  navigator.getUserMedia(constraints, success, errorCallback);

  // Add logic to buttons.
  $('#btn-start').click(function() {
    SERVER_URL = get_url_param('server_url');
    console.log(SERVER_URL);
    demo_running = true;
    //captureImage();
    setInterval(capture_image, 100);
    setInterval(update_annotations, 2000); 
  });
  $('#btn-stop').click(function() { demo_running = false; });
  $('#btn-less').click(function() { NUM_TO_SHOW--; });
  $('#btn-more').click(function() { NUM_TO_SHOW++; });
  $('#btn-smaller').click(function() { IMAGE_DISPLAY_WIDTH -= 100; });
  $('#btn-bigger').click(function()  { IMAGE_DISPLAY_WIDTH += 100; });
});

