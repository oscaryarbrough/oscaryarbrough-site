document.addEventListener("DOMContentLoaded", function () {
  const button = document.querySelector(".social-button");
  const list = document.getElementById("social-list");

  // Toggle visibility on button click
  button.addEventListener("click", function (e) {
    list.classList.toggle("hidden");
    list.classList.toggle("fade-in");
  });

  // Close dropdown if user clicks outside of it
  document.addEventListener("click", function (e) {
    if (!button.contains(e.target) && !list.contains(e.target)) {
      if (!list.classList.contains("hidden")) {
        list.classList.add("hidden");
        list.classList.remove("fade-in");
      }
    }
  });
});