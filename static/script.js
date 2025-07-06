document.addEventListener("DOMContentLoaded", () => {
    const downloadForm = document.getElementById("downloadForm");
    const videoUrlInput = document.getElementById("videoUrl");
    const modeInputs = document.querySelectorAll('input[name="mode"]');
    const submitButton = downloadForm.querySelector('button[type="submit"]');
    const buttonText = submitButton.querySelector('.button-text');
    const spinner = submitButton.querySelector('.spinner');
    const progressContainer = document.getElementById("progressContainer");
    const progressBar = document.getElementById("progressBar");
    const progressInfo = document.getElementById("progressInfo");
    const cancelBtn = document.getElementById("cancelBtn");
    const finishBtn = document.getElementById("finishBtn");
    const notificationContainer = document.getElementById("notification-container");
    const videoPreview = document.getElementById("videoPreview");
    const videoThumbnail = document.getElementById("videoThumbnail");
    const videoTitle = document.getElementById("videoTitle");

    let jobId = null;
    let progressInterval = null;
    let debounceTimeout;

    function showSpinner() {
        buttonText.style.display = 'none';
        spinner.style.display = 'block';
        submitButton.disabled = true;
    }

    function hideSpinner() {
        buttonText.style.display = 'flex';
        spinner.style.display = 'none';
        submitButton.disabled = false;
    }

    function createNotification(message, type) {
        const notif = document.createElement('div');
        notif.className = `notification ${type}`;
        const iconClass = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-times-circle' : 'fa-info-circle';
        notif.innerHTML = `<i class="fas ${iconClass}"></i><p>${message}</p>`;
        notificationContainer.appendChild(notif);
        setTimeout(() => notif.remove(), 5000);
    }

    function disableForm() {
        videoUrlInput.disabled = true;
        modeInputs.forEach(input => input.disabled = true);
    }

    function enableForm() {
        videoUrlInput.disabled = false;
        modeInputs.forEach(input => input.disabled = false);
        hideSpinner();
    }

    async function fetchVideoInfo() {
        const url = videoUrlInput.value.trim();
        if (!url) {
            videoPreview.style.display = 'none';
            return;
        }

        try {
            const response = await fetch('/get_video_info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            });
            const data = await response.json();
            if (data.success) {
                videoThumbnail.src = data.thumbnail;
                videoTitle.textContent = data.title;
                videoPreview.style.display = 'block';
            } else {
                videoPreview.style.display = 'none';
            }
        } catch (error) {
            videoPreview.style.display = 'none';
        }
    }

    videoUrlInput.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(fetchVideoInfo, 500);
    });

    downloadForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        showSpinner();
        createNotification("Starting download...", "info");
        const videoUrl = videoUrlInput.value.trim();
        const mode = document.querySelector('input[name="mode"]:checked').value;

        disableForm();

        try {
            const response = await fetch("/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: videoUrl, mode: mode }),
            });
            const data = await response.json();
            if (data.success) {
                jobId = data.job_id;
                progressContainer.style.display = "block";
                progressInterval = setInterval(fetchProgress, 1000);
            } else {
                createNotification("Error: " + data.error, "error");
                enableForm();
            }
        } catch (error) {
            createNotification("An error occurred. Please try again.", "error");
            enableForm();
        }
    });

    async function fetchProgress() {
        if (!jobId) return;
        try {
            const response = await fetch(`/progress?job_id=${jobId}`);
            const data = await response.json();
            if (data.success) {
                const prog = data.progress;
                let percent = prog.percent.toFixed(2);
                progressBar.style.width = percent + "%";
                let speed = prog.speed;
                let speedStr = speed ? (speed / 1024).toFixed(2) + " KB/s" : "0 KB/s";
                let downloaded = prog.progress;
                let total = prog.total;
                let sizeStr = total ? (downloaded / 1024 / 1024).toFixed(2) + " MB / " + (total / 1024 / 1024).toFixed(2) + " MB" : "";
                progressInfo.textContent = `Downloading: ${percent}% | Speed: ${speedStr} | ${sizeStr}`;

                if (prog.status === "initializing") {
                    progressInfo.textContent = prog.status_message;
                } else if (prog.status === "finished") {
                    createNotification("Download completed successfully!", "success");
                    clearInterval(progressInterval);
                    cancelBtn.style.display = "none";
                    finishBtn.style.display = "inline-flex";
                } else if (prog.status === "cancelled") {
                    createNotification("Download cancelled.", "error");
                    clearInterval(progressInterval);
                    cancelBtn.style.display = "none";
                    finishBtn.style.display = "inline-flex";
                } else if (prog.status === "error") {
                    createNotification("Error during download: " + (prog.error || "Unknown error"), "error");
                    clearInterval(progressInterval);
                    cancelBtn.style.display = "none";
                    finishBtn.style.display = "inline-flex";
                }
            }
        } catch (error) {
            console.error("Progress fetch error:", error);
        }
    }

    cancelBtn.addEventListener("click", async () => {
        if (!jobId) return;
        try {
            const response = await fetch("/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ job_id: jobId }),
            });
            const data = await response.json();
            if (data.success) {
                createNotification("Cancellation requested. The download will stop shortly.", "info");
            }
        } catch (error) {
            console.error("Cancellation error:", error);
        }
    });

    finishBtn.addEventListener("click", () => {
        jobId = null;
        clearInterval(progressInterval);
        progressBar.style.width = "0%";
        progressInfo.textContent = "";
        progressContainer.style.display = "none";
        cancelBtn.style.display = "inline-flex";
        finishBtn.style.display = "none";
        enableForm();
        downloadForm.reset();
        videoPreview.style.display = 'none';
    });
});