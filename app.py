from flask import Flask, request, jsonify, render_template
import os
import yt_dlp
import threading
import uuid

app = Flask(__name__)

# Global dictionary to store download job info (for production, consider a persistent store)
jobs = {}

# Determine the path to the Windows Downloads directory
downloads_dir = os.path.join(os.environ["USERPROFILE"], "Downloads")
os.makedirs(downloads_dir, exist_ok=True)

def download_video_job(job_id, video_url, mode):
    def progress_hook(d):
        # Handle error status from yt-dlp (if reported)
        if d.get('status') == 'error':
            jobs[job_id]['error'] = d.get('error') or 'Unknown error'
            jobs[job_id]['status'] = 'error'
            return

        if d.get('status') == 'downloading':
            jobs[job_id]['progress'] = d.get('downloaded_bytes', 0)
            jobs[job_id]['total'] = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
            jobs[job_id]['speed'] = d.get('speed', 0)
            if jobs[job_id]['total']:
                jobs[job_id]['percent'] = (jobs[job_id]['progress'] / jobs[job_id]['total']) * 100
            else:
                jobs[job_id]['percent'] = 0
            # Check if cancellation was requested
            if jobs[job_id].get('cancelled'):
                jobs[job_id]['status'] = 'cancelled'
                raise Exception("Download cancelled by user.")
        elif d.get('status') == 'finished':
            jobs[job_id]['percent'] = 100
            jobs[job_id]['progress'] = d.get('total_bytes', 0)
            if jobs[job_id].get('cancelled'):
                jobs[job_id]['status'] = 'cancelled'
            else:
                jobs[job_id]['status'] = 'finished'
    
    jobs[job_id]['status'] = 'starting'
    
    # Set options based on mode (audio or video)
    if mode == "audio":
        options = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'outtmpl': os.path.join(downloads_dir, '%(title)s.%(ext)s'),
            'ignoreerrors': True,
            'progress_hooks': [progress_hook],
            'quiet': True
        }
    else:  # video mode with resolution choices
        options = {
            'format': '(bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a])/'
                      '(bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a])/'
                      '(bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a])/bestvideo+bestaudio/best',
            'merge_output_format': 'mp4',
            'outtmpl': os.path.join(downloads_dir, '%(title)s.%(ext)s'),
            'ignoreerrors': True,
            'progress_hooks': [progress_hook],
            'quiet': True
        }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            jobs[job_id]['status'] = 'downloading'
            # Pre-download validation: try to extract video info first
            try:
                info = ydl.extract_info(video_url, download=False)
                if info is None:
                    raise Exception("Failed to retrieve video information.")
            except Exception as info_err:
                raise Exception("Failed to retrieve video information. " + str(info_err))
            # Now proceed to download
            ydl.download([video_url])
            if jobs[job_id]['status'] not in ['cancelled', 'error']:
                jobs[job_id]['status'] = 'finished'
    except Exception as e:
        if jobs[job_id].get('status') not in ['cancelled', 'error']:
            jobs[job_id]['error'] = str(e)
            jobs[job_id]['status'] = 'error'

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/download', methods=['POST'])
def download():
    data = request.get_json()
    if not data or 'url' not in data:
        return jsonify(success=False, error="No URL provided."), 400
    video_url = data['url']
    mode = data.get('mode', 'video')  # default mode is "video"
    job_id = str(uuid.uuid4())
    # Initial job state
    jobs[job_id] = {
        'status': 'initializing',
        'status_message': 'Initializing download... Please wait.',
        'progress': 0,
        'total': 0,
        'percent': 0,
        'speed': 0,
        'cancelled': False,
        'mode': mode
    }
    t = threading.Thread(target=download_video_job, args=(job_id, video_url, mode))
    t.start()
    return jsonify(success=True, job_id=job_id)

@app.route('/progress', methods=['GET'])
def progress():
    job_id = request.args.get('job_id')
    if not job_id or job_id not in jobs:
        return jsonify(success=False, error="Invalid job id."), 400
    return jsonify(success=True, progress=jobs[job_id])

@app.route('/cancel', methods=['POST'])
def cancel():
    data = request.get_json()
    job_id = data.get('job_id')
    if not job_id or job_id not in jobs:
        return jsonify(success=False, error="Invalid job id."), 400
    jobs[job_id]['cancelled'] = True
    return jsonify(success=True, message="Cancellation requested.")

@app.route('/get_video_info', methods=['POST'])
def get_video_info():
    data = request.get_json()
    url = data.get('url')
    if not url:
        return jsonify(success=False, error="URL is required."), 400

    try:
        with yt_dlp.YoutubeDL({'quiet': True}) as ydl:
            info = ydl.extract_info(url, download=False)
            return jsonify(success=True, title=info.get('title'), thumbnail=info.get('thumbnail'))
    except Exception as e:
        return jsonify(success=False, error="Could not retrieve video information."), 500

if __name__ == '__main__':
    app.run(debug=True)